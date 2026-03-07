import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";
import * as schema from "./schema";

export const sql = postgres(env.databaseUrl, {
  max: env.databaseMaxConnections,
  ssl: env.databaseSsl ? "require" : undefined,
});

export const db = drizzle(sql, { schema });

export async function ensureDatabase() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS shielded_notes (
      account text NOT NULL,
      id text NOT NULL,
      tree_number integer NOT NULL,
      leaf_index integer NOT NULL,
      src_chain_id integer NOT NULL,
      dst_chain_id integer NOT NULL,
      from_address text,
      note jsonb NOT NULL,
      status text,
      used_at text,
      committed_at text,
      memo text,
      block_number integer,
      block_timestamp integer,
      master_tree_status text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT shielded_notes_account_id_pk PRIMARY KEY (account, id)
    )
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS shielded_notes_account_status_idx
      ON shielded_notes (account, status)
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS shielded_notes_account_dst_chain_idx
      ON shielded_notes (account, dst_chain_id)
  `);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS wormhole_notes (
      account text NOT NULL,
      id text NOT NULL,
      entry_id text NOT NULL,
      tree_number integer NOT NULL,
      leaf_index integer NOT NULL,
      src_chain_id integer NOT NULL,
      dst_chain_id integer NOT NULL,
      entry jsonb NOT NULL,
      status text,
      used_at text,
      memo text,
      block_number integer,
      block_timestamp integer,
      master_tree_status text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT wormhole_notes_account_id_pk PRIMARY KEY (account, id)
    )
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS wormhole_notes_account_status_idx
      ON wormhole_notes (account, status)
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS wormhole_notes_account_dst_chain_idx
      ON wormhole_notes (account, dst_chain_id)
  `);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS shielded_transfer_requests (
      account text NOT NULL,
      id text NOT NULL,
      receiver text NOT NULL,
      token text NOT NULL,
      token_id text,
      amount text NOT NULL,
      src_chain_id integer NOT NULL,
      dst_chain_id integer NOT NULL,
      status text NOT NULL,
      shielded_input_notes jsonb NOT NULL,
      wormhole_input_note jsonb,
      output_notes jsonb NOT NULL,
      used_at text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT shielded_transfer_requests_account_id_pk PRIMARY KEY (account, id)
    )
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS shielded_transfer_requests_account_status_idx
      ON shielded_transfer_requests (account, status)
  `);
}

export async function closeDatabase() {
  await sql.end({ timeout: 5 });
}
