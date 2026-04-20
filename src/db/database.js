import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = "./data/cognitomark.sqlite";

const DOCUMENT_TABLES = Object.freeze([
	"admins",
	"students",
	"exams",
	"questions",
	"exam_sessions",
	"responses",
	"telemetry_events",
	"click_timeseries",
]);

const SEQUENCE_TABLES = Object.freeze({
	admins: "admins",
	students: "students",
	exams: "exams",
	questions: "questions",
	exam_sessions: "exam_sessions",
	responses: "responses",
	telemetry_events: "telemetry_events",
	click_timeseries: "click_timeseries",
});

let db;

const quoteIdentifier = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

const getSqlitePath = () => process.env.SQLITE_PATH || DEFAULT_DB_PATH;

const ensureDbDirectory = (dbPath) => {
	if (dbPath === ":memory:") {
		return;
	}
	const resolved = path.resolve(dbPath);
	fs.mkdirSync(path.dirname(resolved), { recursive: true });
};

const ensureConnected = () => {
	if (!db) {
		throw new Error("Database is not initialized");
	}
};

const isSqliteUniqueConstraintError = (error) =>
	typeof error?.message === "string" &&
	error.message.includes("UNIQUE constraint failed");

const withMongoLikeDuplicateCode = (error) => {
	if (isSqliteUniqueConstraintError(error)) {
		// Keep legacy duplicate-key handling logic in controllers working.
		error.code = 11000;
	}
	return error;
};

const run = (sql, ...params) => {
	ensureConnected();
	return db.prepare(sql).run(...params);
};

const get = (sql, ...params) => {
	ensureConnected();
	return db.prepare(sql).get(...params);
};

const all = (sql, ...params) => {
	ensureConnected();
	return db.prepare(sql).all(...params);
};

const createDocumentTables = () => {
	for (const table of DOCUMENT_TABLES) {
		db.exec(
			`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table)} (
				row_id INTEGER PRIMARY KEY AUTOINCREMENT,
				doc TEXT NOT NULL
			)`,
		);
	}
};

const createCountersTable = () => {
	db.exec(`CREATE TABLE IF NOT EXISTS counters (
		name TEXT PRIMARY KEY,
		seq INTEGER NOT NULL DEFAULT 0
	)`);
};

const createIndexes = () => {
	db.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_id ON admins (json_extract(doc, '$.id'))",
	);
	db.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_username ON admins (json_extract(doc, '$.username'))",
	);

	db.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_students_id ON students (json_extract(doc, '$.id'))",
	);
	db.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_students_student_id ON students (json_extract(doc, '$.student_id'))",
	);

	db.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_exams_id ON exams (json_extract(doc, '$.id'))",
	);

	db.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_id ON questions (json_extract(doc, '$.id'))",
	);
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON questions (json_extract(doc, '$.exam_id'))",
	);

	db.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_sessions_id ON exam_sessions (json_extract(doc, '$.id'))",
	);
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_exam_sessions_student_id ON exam_sessions (json_extract(doc, '$.student_id'))",
	);
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_exam_sessions_exam_id ON exam_sessions (json_extract(doc, '$.exam_id'))",
	);

	db.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_id ON responses (json_extract(doc, '$.id'))",
	);
	db.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_session_question ON responses (json_extract(doc, '$.session_id'), json_extract(doc, '$.question_id'))",
	);
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_responses_session_id ON responses (json_extract(doc, '$.session_id'))",
	);

	db.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_events_id ON telemetry_events (json_extract(doc, '$.id'))",
	);
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_telemetry_events_session_id ON telemetry_events (json_extract(doc, '$.session_id'))",
	);
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_telemetry_events_type ON telemetry_events (json_extract(doc, '$.type'))",
	);

	db.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS idx_click_timeseries_id ON click_timeseries (json_extract(doc, '$.id'))",
	);
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_click_timeseries_session_id ON click_timeseries (json_extract(doc, '$.session_id'))",
	);
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_click_timeseries_question_id ON click_timeseries (json_extract(doc, '$.question_id'))",
	);
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_click_timeseries_window_start ON click_timeseries (json_extract(doc, '$.window_start'))",
	);
	db.exec(
		"CREATE INDEX IF NOT EXISTS idx_click_timeseries_window_end ON click_timeseries (json_extract(doc, '$.window_end'))",
	);
};

const parseDoc = (value) => {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
};

const normalizeDoc = (doc) => JSON.stringify(doc ?? {});

const assertCollectionName = (name) => {
	if (!DOCUMENT_TABLES.includes(name)) {
		throw new Error(`Unknown collection: ${name}`);
	}
};

export const isValidCollection = (name) => DOCUMENT_TABLES.includes(name);

export const connectDb = async () => {
	if (db) {
		// eslint-disable-next-line no-console
		console.log("SQLite already connected");
		return db;
	}

	const dbPath = getSqlitePath();
	ensureDbDirectory(dbPath);

	db = new DatabaseSync(dbPath);
	db.exec("PRAGMA journal_mode = WAL");

	createDocumentTables();
	createCountersTable();
	createIndexes();

	// eslint-disable-next-line no-console
	console.log(`SQLite connected (${dbPath})`);
	return db;
};

export const getDb = () => {
	ensureConnected();
	return db;
};

export const listCollectionRows = (name) => {
	assertCollectionName(name);
	const table = quoteIdentifier(name);

	return all(`SELECT row_id, doc FROM ${table}`)
		.map((row) => ({
			rowId: Number(row.row_id),
			doc: parseDoc(row.doc),
		}))
		.filter((row) => row.doc && typeof row.doc === "object");
};

export const listCollectionDocs = (name) =>
	listCollectionRows(name).map((row) => structuredClone(row.doc));

export const insertCollectionDoc = (name, doc) => {
	assertCollectionName(name);
	const table = quoteIdentifier(name);

	try {
		const result = run(`INSERT INTO ${table} (doc) VALUES (?)`, normalizeDoc(doc));
		return Number(result.lastInsertRowid);
	} catch (error) {
		throw withMongoLikeDuplicateCode(error);
	}
};

export const updateCollectionDoc = (name, rowId, doc) => {
	assertCollectionName(name);
	const table = quoteIdentifier(name);

	try {
		const result = run(
			`UPDATE ${table} SET doc = ? WHERE row_id = ?`,
			normalizeDoc(doc),
			rowId,
		);
		return Number(result.changes || 0);
	} catch (error) {
		throw withMongoLikeDuplicateCode(error);
	}
};

export const deleteCollectionRows = (name, rowIds) => {
	assertCollectionName(name);
	if (!Array.isArray(rowIds) || rowIds.length === 0) {
		return 0;
	}

	const table = quoteIdentifier(name);
	const placeholders = rowIds.map(() => "?").join(", ");
	const result = run(
		`DELETE FROM ${table} WHERE row_id IN (${placeholders})`,
		...rowIds,
	);
	return Number(result.changes || 0);
};

export const getNextSequence = async (name) => {
	const row = get(
		`INSERT INTO counters (name, seq)
		 VALUES (?, 1)
		 ON CONFLICT(name)
		 DO UPDATE SET seq = seq + 1
		 RETURNING seq`,
		name,
	);

	if (!row || !Number.isFinite(Number(row.seq))) {
		throw new Error(`Failed to generate sequence for ${name}`);
	}

	return Number(row.seq);
};

export const setSequenceAtLeast = async (name, value) => {
	const numericValue = Number(value);
	if (!Number.isFinite(numericValue)) {
		return;
	}

	run(
		`INSERT INTO counters (name, seq)
		 VALUES (?, ?)
		 ON CONFLICT(name)
		 DO UPDATE SET seq = CASE WHEN seq < excluded.seq THEN excluded.seq ELSE seq END`,
		name,
		Math.trunc(numericValue),
	);
};

export const resetSequences = async (names) => {
	for (const name of names) {
		run(
			`INSERT INTO counters (name, seq)
			 VALUES (?, 0)
			 ON CONFLICT(name)
			 DO UPDATE SET seq = 0`,
			name,
		);
	}
};

export const listSequences = () =>
	all("SELECT name, seq FROM counters ORDER BY name ASC").map((row) => ({
		name: row.name,
		seq: Number(row.seq),
	}));

export const syncAllSequences = async () => {
	for (const [sequenceName, tableName] of Object.entries(SEQUENCE_TABLES)) {
		const docs = listCollectionDocs(tableName);
		const maxId = docs.reduce((max, doc) => {
			const id = Number(doc?.id);
			return Number.isFinite(id) && id > max ? id : max;
		}, 0);

		if (maxId > 0) {
			await setSequenceAtLeast(sequenceName, maxId);
		}
	}
};

export const closeDb = async () => {
	if (!db) {
		return;
	}
	db.close();
	db = undefined;
};
