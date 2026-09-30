// The redesign's Dropdown IS components/FilterDropdown — the shared picker the
// chip-rows → dropdowns plan (vault: 2026-09-28_chip-rows-to-dropdowns-PLAN.md) already
// built and 20 screens import. Re-exported here so redesigned screens import everything
// from components/ui, and so there is never a third dropdown next to Dropdown.js and
// FilterDropdown (the audit found two already doing one job).
export { default } from '../FilterDropdown'
