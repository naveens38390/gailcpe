/** Minimal config so `npm test` runs the handful of pure unit tests (T4, decision 06 §14). */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
};
