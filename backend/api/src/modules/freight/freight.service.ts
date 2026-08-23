import { Injectable } from "@nestjs/common";

import { normalise } from "../../core/pricing";
import { DatasetService } from "../dataset/dataset.service";

/**
 * Freight Intelligence.
 *
 * Freight decides more comparisons than basic price does, because GAIL, HMEL,
 * OPaL and HPL all sell ex-works while RIL and IOCL sell delivered. A producer
 * with no row here is *unpriced*, not free — so the response says which
 * producers publish a rate to this destination and which do not.
 */
@Injectable()
export class FreightService {
  constructor(private dataset: DatasetService) {}

  async atLocation(location: string, asOf?: Date) {
    const data = await this.dataset.load(asOf);
    // The engine types producers by the six known codes; here they arrive as
    // plain keys off the freight books, so widen once rather than cast per use.
    const producers = data.priceIndex.producers as Record<
      string,
      { basis: string } | undefined
    >;
    const rows = Object.entries(data.freight.books).map(([producer, book]) => {
      const mapped = data.freight.destination_map?.[producer]?.[location];
      const key = normalise(mapped ?? location);
      const hit = book.find((r) => normalise(r.destination) === key);
      return {
        producer,
        basis: producers[producer]?.basis ?? null,
        destination: hit?.destination ?? null,
        ratePerMt: hit?.rate_per_mt ?? null,
        insurancePerMt: hit?.insurance_per_mt ?? 0,
        published: Boolean(hit),
      };
    });

    const delivered = Object.entries(data.priceIndex.producers)
      .filter(([, payload]) => payload.basis === "delivered")
      .map(([producer]) => producer);

    const quoted = rows.filter((r) => r.published && r.ratePerMt !== null);
    const cheapest = quoted.length
      ? quoted.reduce((best, r) => (r.ratePerMt! < best.ratePerMt! ? r : best))
      : null;

    return {
      location,
      effectiveDate: data.freight.effective_date,
      rows,
      cheapest: cheapest?.producer ?? null,
      notes: [
        delivered.length
          ? `${delivered.join(" and ")} publish delivered prices — their freight is already inside the price and is not shown here.`
          : null,
        rows.some((r) => !r.published)
          ? `No published rate to this location for ${rows
              .filter((r) => !r.published)
              .map((r) => r.producer)
              .join(", ")}.`
          : null,
        rows.some((r) => r.insurancePerMt > 0)
          ? "OPaL bills insurance separately; it is excluded from landed cost and shown as its own column."
          : null,
      ].filter(Boolean),
    };
  }

  /** Where a producer's freight advantage is widest, for territory planning. */
  async spread(producerA: string, producerB: string, asOf?: Date) {
    const data = await this.dataset.load(asOf);
    const bookA = data.freight.books[producerA] ?? [];
    const bookB = data.freight.books[producerB] ?? [];
    const byKeyB = new Map(bookB.map((r) => [normalise(r.destination), r]));

    return bookA
      .map((a) => {
        const b = byKeyB.get(normalise(a.destination));
        if (!b) return null;
        return {
          destination: a.destination,
          [producerA]: a.rate_per_mt,
          [producerB]: b.rate_per_mt,
          advantage: Math.round((b.rate_per_mt - a.rate_per_mt) * 100) / 100,
        };
      })
      .filter(Boolean)
      .sort((x: any, y: any) => y.advantage - x.advantage);
  }
}
