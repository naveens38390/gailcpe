# Post-release verification checklist — Ex Works / Ex Depot

Run this against production once Push A, `load-depot --apply`, and Push B are all live. It complements
`npm run verify-release -- --stage post-load --with-deal`, which automates most of the numeric checks
below — this list is what to look at with your own eyes, on the real app.

## Compare — Ex Works
- [ ] Select a grade and a town with several producers; all six cards price with the works ladder
      (Basic, Less CD, Less TD, Pre Sale Discount, Net Basic, Freight, Basic + Freight, Price Net of GST,
      Price Delta)
- [ ] HPL now prices at Bhiwandi (it did not before this release)

## Compare — Ex Depot
- [ ] Switch the global Price Basis selector to Ex Depot; the ladder changes (Basic, CD, Dealer Discount
      where RIL, Price Net of GST, Price Delta), no Freight row
- [ ] RIL's card shows the ₹350 dealer discount and its price is ₹350 lower than the raw depot basic

## Mixed Basis banner
- [ ] Override two or three cards to the other basis; the "Mixed Basis Comparison Active" banner appears
      and names exactly those cards
- [ ] Reset one card: only that card returns to the global basis
- [ ] Reset All Cards: every override clears, banner disappears

## Not Published cards
- [ ] A town/grade where a producer has no depot price shows "This producer has not published an Ex
      Depot price for this grade at this location." with no price

## Deal — Ex Works
- [ ] Bhiwandi B52A003: leader is IOCL, narrative and recommendation match what Compare shows

## Deal — Ex Depot
- [ ] Bhiwandi B52A003: leader is RIL, gap reflects RIL's dealer discount (≈ ₹1,550 vs GAIL)

## Not Published flow (Deal)
- [ ] A town where GAIL has no depot price returns `outcome: not_priced` with a plain sentence, not an
      error

## History
- [ ] A Compare run appears in history with the right `pricingBasis`
- [ ] A mixed-basis Compare run's history record shows `basisOverrides` and each producer's own basis in
      its stored quotes
- [ ] A Deal simulation appears in Deal history with the right `pricingBasis`

## Mobile (390px)
- [ ] Price Basis selector and its coverage help text fit without truncation
- [ ] A card's grade selector, basis selector, CUSTOM BASIS badge and Reset button don't overlap
- [ ] The Mixed Basis banner is fully readable

## APK smoke test
- [ ] Install the built APK on a real Android device
- [ ] Log in; run one Ex Works comparison, one Ex Depot comparison, one Deal simulation
- [ ] Confirm it points at the production API, and the version shown matches the release

## If anything here fails
See `docs/rollback-runbook.md`.
