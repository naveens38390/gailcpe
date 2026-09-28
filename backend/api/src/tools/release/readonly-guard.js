// Preload (node --require) for anything that must provably not write to the database:
// production dry runs, `backup-collections`, `verify-production`.
//  1. Mongoose must not auto-create collections or build indexes when a model is registered.
//  2. Every write method of the MongoDB driver mongoose uses throws before anything is sent.
//  3. Aggregations with $out / $merge are refused.
// It changes nothing in the code it guards; it only blocks writes.
const path = require("path");

const mongoosePath = require.resolve("mongoose", { paths: [process.cwd(), __dirname] });
const mongoose = require(mongoosePath);
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

// The driver copy mongoose itself loads (it may be nested under mongoose/node_modules).
const driverPath = require.resolve("mongodb", { paths: [path.dirname(mongoosePath)] });
const { Collection, Db } = require(driverPath);
const block = (owner, names) => {
  for (const n of names) {
    if (typeof owner.prototype[n] !== "function") continue;
    owner.prototype[n] = function () {
      throw new Error(`READ-ONLY GUARD: blocked ${owner.name}.${n}() — this run must not write`);
    };
  }
};
block(Collection, ["insertOne", "insertMany", "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany",
  "bulkWrite", "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete", "createIndex", "createIndexes",
  "dropIndex", "dropIndexes", "drop", "rename", "initializeOrderedBulkOp", "initializeUnorderedBulkOp"]);
block(Db, ["createCollection", "dropCollection", "dropDatabase", "renameCollection", "createIndex"]);
const aggregate = Collection.prototype.aggregate;
Collection.prototype.aggregate = function (pipeline, ...rest) {
  if (JSON.stringify(pipeline ?? []).match(/"\$(out|merge)"/)) throw new Error("READ-ONLY GUARD: blocked $out/$merge");
  return aggregate.call(this, pipeline, ...rest);
};
console.error(`[read-only guard active: autoIndex=${mongoose.get("autoIndex")} autoCreate=${mongoose.get("autoCreate")}, driver writes blocked]`);
