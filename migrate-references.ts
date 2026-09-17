import mysql from "mysql2/promise";
import { escape, type RowDataPacket } from "mysql2";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config as dotenv } from "dotenv";

const output = path.join(__dirname, "./new_bd.sql");

type OldReferenceRow = RowDataPacket & {
    code: number;
    title: string;
    type: "report" | "thesis" | "article" | "website" | "book";
    referenceYear: number | null;
    other: string | null;

    cityName: string | null;

    pageStart: number | null;
    pageEnd: number | null;

    journalVolume: number | null;
    journalIssue: number | null;
    journalVolumeYear: number | null;

    journalName: string | null;
};

function buildReferenceText(ref: OldReferenceRow): string {
    const parts: string[] = [];

    parts.push(ref.title);

    switch (ref.type) {
        case "article":
            if (ref.journalName) {
                parts.push(ref.journalName);
            }

            if (ref.journalVolume !== null) {
                let volume = `Vol. ${ref.journalVolume}`;

                if (ref.journalIssue !== null) {
                    volume += `(${ref.journalIssue})`;
                }

                parts.push(volume);
            }

            if (ref.pageStart !== null && ref.pageEnd !== null) {
                parts.push(`pp. ${ref.pageStart}-${ref.pageEnd}`);
            }

            break;

        case "thesis":
        case "report":
        case "book":
            if (ref.cityName) {
                parts.push(ref.cityName);
            }

            break;

        case "website":
            break;
    }

    if (ref.referenceYear !== null) {
        parts.push(String(ref.referenceYear));
    }

    if (ref.other) {
        parts.push(ref.other);
    }

    return (
        parts
            .map((part) => part.trim().replace(/[.\s]+$/, ""))
            .filter(Boolean)
            .join(". ") + "."
    );
}

async function main(): Promise<void> {
    dotenv();

    const db = await mysql.createConnection({
        host: process.env.DATABASE_HOST,
        user: process.env.DATABASE_USERNAME,
        password: process.env.DATABASE_PASSWORD,
        database: process.env.DATABASE_NAME,
    });

    try {
        const [references] = await db.query<OldReferenceRow[]>(`
            select
                r.code,
                r.title,
                r.type,
                r.year as referenceYear,
                r.other,

                rc.name as cityName,

                r_article.page_start as pageStart,
                r_article.page_end as pageEnd,

                j_volume.volume as journalVolume,
                j_volume.issue as journalIssue,
                j_volume.year as journalVolumeYear,

                j.name as journalName
            from reference as r
                     left join ref_city as rc
                               on r.ref_city_id = rc.id
                     left join ref_article as r_article
                               on r.ref_article_id = r_article.id
                     left join journal_volume as j_volume
                               on r_article.volume_id = j_volume.id

                     left join journal as j
                               on j_volume.journal_id = j.id
            order by r.code
        `);

        const values = references.map((ref) => ({
            code: ref.code,
            text: buildReferenceText(ref),
        }));

        const inserts = values.map(
            (ref) => `(${ref.code}, ${escape(ref.text)})`
        );

        const sql = inserts.length > 0
                ? `insert into reference (code, text) values  ${inserts.join(",\n")};`  : "";

        const fileContent = await readFile(output, "utf8");

        const newline = fileContent.includes("\r\n") ? "\r\n" : "\n";

        const lines = fileContent.split(/\r?\n/);

        const startLine = 13983;
        const endLine = 14007;

        const updatedContent = [
            ...lines.slice(0, startLine - 1),
            sql,
            ...lines.slice(endLine),
        ].join(newline);

        await writeFile(output, updatedContent, "utf8");
    } finally {
        await db.end();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
