import { Aggregator, Query } from "mingo";
import {
  deleteCollectionRows,
  insertCollectionDoc,
  isValidCollection,
  listCollectionDocs,
  listCollectionRows,
  updateCollectionDoc,
} from "./database.js";

const clone = (value) => structuredClone(value);

const applyProjection = (doc, projection) => {
  if (!projection || typeof projection !== "object") {
    return doc;
  }

  const keys = Object.keys(projection).filter((key) => key !== "_id");
  if (!keys.length) {
    return doc;
  }

  const hasInclusions = keys.some(
    (key) => projection[key] === 1 || projection[key] === true,
  );

  if (hasInclusions) {
    const result = {};
    for (const key of keys) {
      if (projection[key] === 1 || projection[key] === true) {
        result[key] = doc[key];
      }
    }
    return result;
  }

  const result = { ...doc };
  for (const key of keys) {
    if (projection[key] === 0 || projection[key] === false) {
      delete result[key];
    }
  }
  return result;
};

const compareValues = (left, right) => {
  if (left === right) {
    return 0;
  }

  if (left === null || left === undefined) {
    return -1;
  }

  if (right === null || right === undefined) {
    return 1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right));
};

const sortDocuments = (docs, sortSpec) => {
  const sortEntries = Object.entries(sortSpec || {});
  if (!sortEntries.length) {
    return docs;
  }

  return [...docs].sort((a, b) => {
    for (const [field, direction] of sortEntries) {
      const comparison = compareValues(a[field], b[field]);
      if (comparison !== 0) {
        return direction < 0 ? -comparison : comparison;
      }
    }
    return 0;
  });
};

const buildUpsertBase = (filter) => {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    return {};
  }

  const base = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith("$")) {
      continue;
    }

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      base[key] = value;
    }
  }

  return base;
};

const applyUpdateDocument = (doc, update, isInsert) => {
  if (!update || typeof update !== "object") {
    return doc;
  }

  const hasOperators = Object.keys(update).some((key) => key.startsWith("$"));
  if (!hasOperators) {
    return { ...doc, ...update };
  }

  const nextDoc = { ...doc };

  if (isInsert && update.$setOnInsert && typeof update.$setOnInsert === "object") {
    Object.assign(nextDoc, update.$setOnInsert);
  }

  if (update.$set && typeof update.$set === "object") {
    Object.assign(nextDoc, update.$set);
  }

  if (update.$unset && typeof update.$unset === "object") {
    for (const key of Object.keys(update.$unset)) {
      delete nextDoc[key];
    }
  }

  return nextDoc;
};

class FindQuery {
  constructor(model, mode, filter = {}, projection = null) {
    this.model = model;
    this.mode = mode;
    this.filter = filter || {};
    this.projection = projection;
    this.sortSpec = null;
    this.limitCount = null;
  }

  sort(spec) {
    this.sortSpec = spec;
    return this;
  }

  limit(count) {
    this.limitCount = Number(count);
    return this;
  }

  select(projection) {
    this.projection = projection;
    return this;
  }

  async lean() {
    let docs = await this.model._find(this.filter);
    docs = sortDocuments(docs, this.sortSpec);

    if (this.mode === "one") {
      const first = docs[0] ?? null;
      return first ? applyProjection(clone(first), this.projection) : null;
    }

    if (Number.isFinite(this.limitCount)) {
      docs = docs.slice(0, this.limitCount);
    }

    return docs.map((doc) => applyProjection(clone(doc), this.projection));
  }
}

class AggregateQuery {
  constructor(model, pipeline) {
    this.model = model;
    this.pipeline = pipeline;
  }

  async exec() {
    return this.model._aggregate(this.pipeline);
  }
}

class SqliteModelAdapter {
  constructor(collectionName) {
    if (!isValidCollection(collectionName)) {
      throw new Error(`Unknown model collection: ${collectionName}`);
    }
    this.collectionName = collectionName;
  }

  async _rows() {
    return listCollectionRows(this.collectionName);
  }

  async _docs() {
    return listCollectionDocs(this.collectionName);
  }

  async _find(filter = {}) {
    const query = new Query(filter || {});
    const docs = await this._docs();
    return docs.filter((doc) => query.test(doc));
  }

  async _aggregate(pipeline) {
    const docs = await this._docs();
    const aggregator = new Aggregator(pipeline || [], {
      collectionResolver: (collectionName) => {
        if (!isValidCollection(collectionName)) {
          return [];
        }
        return listCollectionDocs(collectionName);
      },
    });

    return clone(aggregator.run(clone(docs)));
  }

  find(filter = {}, projection = null) {
    return new FindQuery(this, "many", filter, projection);
  }

  findOne(filter = {}, projection = null) {
    return new FindQuery(this, "one", filter, projection);
  }

  async create(doc) {
    const payload = clone(doc ?? {});
    insertCollectionDoc(this.collectionName, payload);
    return payload;
  }

  async updateOne(filter = {}, update = {}, options = {}) {
    const rows = await this._rows();
    const query = new Query(filter || {});
    const row = rows.find((entry) => query.test(entry.doc));

    if (!row) {
      if (options.upsert) {
        const newDoc = applyUpdateDocument(buildUpsertBase(filter), update, true);
        await this.create(newDoc);
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 1,
        };
      }

      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
      };
    }

    const nextDoc = applyUpdateDocument(row.doc, update, false);
    updateCollectionDoc(this.collectionName, row.rowId, nextDoc);

    return {
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
    };
  }

  async updateMany(filter = {}, update = {}) {
    const rows = await this._rows();
    const query = new Query(filter || {});

    let modifiedCount = 0;
    for (const row of rows) {
      if (!query.test(row.doc)) {
        continue;
      }

      const nextDoc = applyUpdateDocument(row.doc, update, false);
      updateCollectionDoc(this.collectionName, row.rowId, nextDoc);
      modifiedCount += 1;
    }

    return {
      acknowledged: true,
      matchedCount: modifiedCount,
      modifiedCount,
    };
  }

  async deleteOne(filter = {}) {
    const rows = await this._rows();
    const query = new Query(filter || {});
    const row = rows.find((entry) => query.test(entry.doc));

    if (!row) {
      return { acknowledged: true, deletedCount: 0 };
    }

    deleteCollectionRows(this.collectionName, [row.rowId]);
    return { acknowledged: true, deletedCount: 1 };
  }

  async deleteMany(filter = {}) {
    const rows = await this._rows();
    const query = new Query(filter || {});
    const rowIds = rows.filter((entry) => query.test(entry.doc)).map((entry) => entry.rowId);

    const deletedCount = deleteCollectionRows(this.collectionName, rowIds);
    return { acknowledged: true, deletedCount };
  }

  async countDocuments(filter = {}) {
    const docs = await this._find(filter);
    return docs.length;
  }

  async bulkWrite(operations = [], options = {}) {
    const ordered = options.ordered !== false;

    for (const operation of operations) {
      if (!operation || typeof operation !== "object") {
        continue;
      }

      if (operation.updateOne) {
        try {
          await this.updateOne(
            operation.updateOne.filter,
            operation.updateOne.update,
            operation.updateOne,
          );
        } catch (error) {
          if (ordered) {
            throw error;
          }
        }
      }
    }

    return { acknowledged: true };
  }

  aggregate(pipeline = []) {
    return new AggregateQuery(this, pipeline);
  }

  async syncIndexes() {
    return true;
  }
}

export const createModel = (collectionName) => new SqliteModelAdapter(collectionName);
