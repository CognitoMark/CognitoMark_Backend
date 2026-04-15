import mongoose from "mongoose";

let db;

const DEFAULT_DB_NAME = "exam_portal";

export const connectDb = async () => {
	if (mongoose.connection.readyState === 1 && db) {
		// eslint-disable-next-line no-console
		console.log("MongoDB already connected");
		return db;
	}

	const uri = process.env.MONGODB_URI;
	if (!uri) {
		throw new Error("MONGODB_URI is not set");
	}

	await mongoose.connect(uri, {
		dbName: process.env.MONGODB_DB || DEFAULT_DB_NAME,
	});

	db = mongoose.connection.db;
	// eslint-disable-next-line no-console
	console.log("MongoDB connected");
	return db;
};

export const getDb = () => {
	if (!db) {
		throw new Error("Database is not initialized");
	}
	return db;
};

export const getCollection = (name) => getDb().collection(name);

export const getNextSequence = async (name) => {
	const counters = getCollection("counters");
	const result = await counters.findOneAndUpdate(
		{ _id: name },
		{ $inc: { seq: 1 } },
		{ upsert: true, returnDocument: "after" },
	);

	if (typeof result?.value?.seq === "number") {
		return result.value.seq;
	}

	const doc = await counters.findOne({ _id: name });
	if (!doc || typeof doc.seq !== "number") {
		throw new Error(`Failed to generate sequence for ${name}`);
	}

	return doc.seq;
};

export const closeDb = async () => {
	if (mongoose.connection.readyState !== 0) {
		await mongoose.disconnect();
		db = null;
	}
};
