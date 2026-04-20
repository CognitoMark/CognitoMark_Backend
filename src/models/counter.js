import { resetSequences, setSequenceAtLeast } from "../db/database.js";

export const Counter = {
  async updateMany(filter = {}, update = {}) {
    const names = Array.isArray(filter?._id?.$in) ? filter._id.$in : [];
    const seq = Number(update?.$set?.seq);

    if (!names.length || !Number.isFinite(seq)) {
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    }

    if (seq === 0) {
      await resetSequences(names);
    } else {
      for (const name of names) {
        await setSequenceAtLeast(name, seq);
      }
    }

    return {
      acknowledged: true,
      matchedCount: names.length,
      modifiedCount: names.length,
    };
  },
};
