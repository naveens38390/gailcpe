# What's new: Ex Works and Ex Depot pricing

*For the GAIL sales and pricing team. Not yet released; this describes the version being prepared.*

## What you can now do

- **Choose a Price Basis on the Compare page.** Pick Ex Works or Ex Depot under Location. All six producers switch together (unless you override a card, below) and use the matching price ladder.
- **Choose a Price Basis on the Deal page.** The same selector sits directly under Location. Rankings, gaps, recommendations and price-correction options all follow your choice, and a saved simulation remembers which basis it was run on.
- **Override one producer's basis on Compare.** Each card has its own Ex Works / Ex Depot selector, so you can compare, say, GAIL on Ex Works against HMEL on Ex Depot. Overridden cards are marked CUSTOM BASIS, a "Mixed Basis Comparison" banner lists them, and "Reset All Cards" (or Reset on a card) puts them back. Changing the global basis keeps your overrides. Deal uses one basis only.
- **Compare depot prices.** Ex Depot shows each producer's depot or stock-point price, collected from the depot, so there is no freight line.

## What you will notice

- **"Not published" instead of a number.** Where a producer has no depot price for a grade at a town, its card says so. Nothing is estimated. If GAIL itself has no stock-point price at a town, the screen says there is nothing to compare.
- **RIL's dealer discount is in RIL's Ex Depot price.** The Rs 350/MT comes off RIL's depot price, on cash and credit, and never appears on Ex Works. RIL's depot price is therefore Rs 350 lower than the Excel sheet shows, and the gap to GAIL is Rs 350 wider.
  - *Example, Bhiwandi, B52 blow moulding:* RIL Rs 1,40,320 − cash discount Rs 1,100 − dealer discount Rs 350 = **Rs 1,38,870**. GAIL is Rs 1,40,420, so the Price Delta is **Rs 1,550** (the sheet shows Rs 1,200 because it leaves the dealer discount out).
- **Price Delta always comes from the price you see** on each card: GAIL's price net of GST minus the competitor's.
- **Rankings can change with the basis.** In our test runs the leader or the outcome differed between Ex Works and Ex Depot in 623 of 1,252 simulated deals, partly because some producers publish no depot price at some towns. At Bhiwandi, IOCL leads Ex Works but RIL leads Ex Depot.
- **Haldia (HPL) now has a price for Bhiwandi** on both bases. It was missing before.
- **Depot prices exist only where the producer publishes a depot for that town.** Of 313 towns: GAIL 57, IOCL 57, RIL 39, HMEL 56, HPL 155, OPaL 41. The rest show "Not published". We never borrow a nearby town's price.

## What did not change

- Ex Works pricing, freight, discounts and rankings are unchanged for anyone who stays on Ex Works, which remains the default, apart from Haldia now being priced at Bhiwandi (above).
- Excel and PDF exports do not include depot prices.

## Two things we would like you to confirm

1. **GAIL's cash discount on a depot (stock-point) sale.** The circular is silent, and your sheet leaves it blank, so we treat it as none.
2. **RIL's dealer discount on credit terms.** We apply it on both cash and credit.
