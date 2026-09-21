import type { PricingBasis } from "../services/api";
import { SelectField, type Option } from "./select";

export const BASIS_LABEL: Record<PricingBasis, string> = {
  ex_works: "Ex Works",
  ex_depot: "Ex Depot",
};

const OPTIONS: Option[] = [
  {
    value: "ex_works",
    label: "Ex Works",
    detail: "Each producer's works price. Freight added for ex-works sellers.",
  },
  {
    value: "ex_depot",
    label: "Ex Depot",
    detail: "Each producer's depot / stock-point price, collected from the depot. No freight.",
  },
];

/**
 * Which of every producer's two price lists a comparison is read from. The
 * default for every producer. Compare lets a single card override it; Deal uses
 * this one choice for the whole simulation.
 */
export function PriceBasisField({
  value,
  onChange,
  disabled,
}: {
  value: PricingBasis;
  onChange: (basis: PricingBasis) => void;
  disabled?: boolean;
}) {
  return (
    <SelectField
      label="Price Basis"
      placeholder="Select a basis"
      value={value}
      hint="Ex Depot prices are shown only where the producer publishes depot pricing for that location."
      options={OPTIONS}
      onChange={(v) => onChange(v as PricingBasis)}
      disabled={disabled}
    />
  );
}
