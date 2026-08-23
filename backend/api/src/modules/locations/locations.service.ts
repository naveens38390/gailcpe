import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { Location } from "../../database/schemas/catalog.schema";
import { DatasetService } from "../dataset/dataset.service";
import { MasterDataService } from "../master-data/master-data.service";
import { RevisionWorkflow } from "../master-data/revision-workflow";
import { CreateLocationDto, DraftLocationDto, ZoneMapPatch } from "./dto/location-fields.dto";

const ZONE_MAP_FIELDS = ["producerZone", "producerZoneTier", "freightDestination"] as const;

/** Apply a partial patch (null deletes a key) onto an existing zone map. */
function mergeZoneMap(
  current: Record<string, string> | undefined,
  patch: ZoneMapPatch,
): Record<string, string> {
  const merged = { ...(current ?? {}) };
  for (const [producer, zone] of Object.entries(patch)) {
    if (zone === null) delete merged[producer];
    else merged[producer] = zone;
  }
  return merged;
}

@Injectable()
export class LocationsService extends MasterDataService {
  protected workflow: RevisionWorkflow;

  constructor(
    @InjectModel(Location.name) private locations: Model<Location>,
    @InjectModel("LocationRevision") private revisions: Model<any>,
    private dataset: DatasetService,
  ) {
    super();
    this.workflow = new RevisionWorkflow(this.revisions, this.locations, "name");
  }

  /**
   * A zone-mapping fix changes how a customer's town resolves for every
   * producer — the exact class of bug Silvassa/Noida was. Locations are read
   * fresh as part of every round build already, so a plain invalidate is
   * enough to make an edit take effect immediately.
   */
  protected invalidate(): void {
    this.dataset.invalidate();
  }

  async search(term: string, limit = 25) {
    const q = term.trim().toUpperCase();
    return this.locations
      .find(q ? { name: new RegExp(q.replace(/[^A-Z0-9 ]/g, ""), "i") } : {})
      .limit(limit)
      .lean();
  }

  async create(dto: CreateLocationDto, userId: string) {
    const { name, reason, submit, ...changes } = dto;
    const fields = this.buildFields(undefined, changes);
    const rev = await this.workflow.draft(name, fields, reason, userId, true);
    return submit === false ? rev : this.workflow.submit(String(rev._id), userId);
  }

  async draft(name: string, dto: DraftLocationDto, userId: string) {
    const { reason, submit, ...changes } = dto;
    const live = await this.locations.findOne({ name }).lean();
    const fields = this.buildFields(live ?? undefined, changes);
    const rev = await this.workflow.draft(name, fields, reason, userId, false);
    return submit === false ? rev : this.workflow.submit(String(rev._id), userId);
  }

  private buildFields(
    live: Location | undefined,
    changes: Omit<DraftLocationDto, "reason" | "submit">,
  ): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    if (changes.sapCode !== undefined) fields.sapCode = changes.sapCode;
    for (const key of ZONE_MAP_FIELDS) {
      const patch = changes[key];
      if (patch !== undefined) {
        fields[key] = mergeZoneMap(live?.[key], patch);
      }
    }
    return fields;
  }
}
