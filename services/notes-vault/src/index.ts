import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError, type ZodType } from "zod";
import { closeDatabase, ensureDatabase } from "./db";
import { env } from "./env";
import {
  createShieldedNote,
  createShieldedNotes,
  createShieldedTransferRequest,
  createWormholeNote,
  createWormholeNotes,
  deleteShieldedNote,
  deleteWormholeNote,
  getShieldedNote,
  getShieldedTransferRequest,
  getWormholeNote,
  listShieldedNotes,
  listWormholeNotes,
  patchShieldedNote,
  patchWormholeNote,
  replaceShieldedNote,
  replaceWormholeNote,
  updateShieldedTransferRequestStatus,
} from "./repository";
import { createShieldedTransferOutputNotes, getShieldedTransferInputEntries } from "./shielded-transfer";
import type { NoteDBShieldedEntry, NoteDBWormholeEntry, ShieldedTransferRequest } from "./types";
import {
  accountParamsSchema,
  createShieldedTransferRequestSchema,
  idParamsSchema,
  requestIdParamsSchema,
  shieldedBatchCreateSchema,
  shieldedListQuerySchema,
  shieldedNotePatchSchema,
  shieldedNoteSchema,
  updateShieldedTransferRequestStatusSchema,
  wormholeBatchCreateSchema,
  wormholeListQuerySchema,
  wormholeNotePatchSchema,
  wormholeNoteSchema,
} from "./validation";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function asyncHandler(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

function parse<T>(schema: ZodType<T>, input: unknown): T {
  return schema.parse(input);
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function assertPathId<T extends { id: string }>(pathId: string, payload: T) {
  if (payload.id !== pathId) {
    throw new HttpError(400, "Payload id must match the route parameter");
  }
}

function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      service: "notes-vault",
      status: "ok",
      routes: [
        "/healthz",
        "/accounts/:account/shielded-notes",
        "/accounts/:account/wormhole-notes",
        "/accounts/:account/shielded-transfer-requests",
      ],
    });
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get(
    "/accounts/:account/shielded-notes",
    asyncHandler(async (req, res) => {
      const { account } = parse(accountParamsSchema, req.params);
      const filters = parse(shieldedListQuerySchema, req.query);
      const notes = await listShieldedNotes(account, filters);
      res.json({ data: notes });
    }),
  );

  app.get(
    "/accounts/:account/shielded-notes/:id",
    asyncHandler(async (req, res) => {
      const { account, id } = parse(idParamsSchema, req.params);
      const note = await getShieldedNote(account, id);
      if (!note) {
        throw new HttpError(404, "Shielded note not found");
      }
      res.json({ data: note });
    }),
  );

  app.post(
    "/accounts/:account/shielded-notes",
    asyncHandler(async (req, res) => {
      const { account } = parse(accountParamsSchema, req.params);
      const note = parse(shieldedNoteSchema, req.body);
      try {
        const created = await createShieldedNote(account, note);
        res.status(201).json({ data: created });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(409, `Shielded note ${note.id} already exists for ${account}`);
        }
        throw error;
      }
    }),
  );

  app.post(
    "/accounts/:account/shielded-notes/batch",
    asyncHandler(async (req, res) => {
      const { account } = parse(accountParamsSchema, req.params);
      const { notes } = parse(shieldedBatchCreateSchema, req.body);
      try {
        const created = await createShieldedNotes(account, notes);
        res.status(201).json({ data: created });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(409, "One or more shielded notes already exist for this account");
        }
        throw error;
      }
    }),
  );

  app.put(
    "/accounts/:account/shielded-notes/:id",
    asyncHandler(async (req, res) => {
      const { account, id } = parse(idParamsSchema, req.params);
      const note = parse(shieldedNoteSchema, req.body);
      assertPathId(id, note);
      const updated = await replaceShieldedNote(account, id, note);
      if (!updated) {
        throw new HttpError(404, "Shielded note not found");
      }
      res.json({ data: updated });
    }),
  );

  app.patch(
    "/accounts/:account/shielded-notes/:id",
    asyncHandler(async (req, res) => {
      const { account, id } = parse(idParamsSchema, req.params);
      const patch = parse(shieldedNotePatchSchema, req.body);
      const updated = await patchShieldedNote(account, id, patch as Partial<NoteDBShieldedEntry>);
      if (!updated) {
        throw new HttpError(404, "Shielded note not found");
      }
      res.json({ data: updated });
    }),
  );

  app.delete(
    "/accounts/:account/shielded-notes/:id",
    asyncHandler(async (req, res) => {
      const { account, id } = parse(idParamsSchema, req.params);
      const deleted = await deleteShieldedNote(account, id);
      if (!deleted) {
        throw new HttpError(404, "Shielded note not found");
      }
      res.json({ data: deleted });
    }),
  );

  app.get(
    "/accounts/:account/wormhole-notes",
    asyncHandler(async (req, res) => {
      const { account } = parse(accountParamsSchema, req.params);
      const filters = parse(wormholeListQuerySchema, req.query);
      const notes = await listWormholeNotes(account, filters);
      res.json({ data: notes });
    }),
  );

  app.get(
    "/accounts/:account/wormhole-notes/:id",
    asyncHandler(async (req, res) => {
      const { account, id } = parse(idParamsSchema, req.params);
      const note = await getWormholeNote(account, id);
      if (!note) {
        throw new HttpError(404, "Wormhole note not found");
      }
      res.json({ data: note });
    }),
  );

  app.get(
    "/accounts/:account/shielded-transfer-requests/:requestId",
    asyncHandler(async (req, res) => {
      const { account, requestId } = parse(requestIdParamsSchema, req.params);
      const request = await getShieldedTransferRequest(account, requestId);
      if (!request) {
        throw new HttpError(404, "Shielded transfer request not found");
      }
      res.json({ data: request });
    }),
  );

  app.post(
    "/accounts/:account/shielded-transfer-requests",
    asyncHandler(async (req, res) => {
      const { account } = parse(accountParamsSchema, req.params);
      const body = parse(createShieldedTransferRequestSchema, req.body);
      const amount = BigInt(body.amount);
      if (amount <= 0n) {
        throw new HttpError(400, "Amount must be greater than zero");
      }

      const { shielded, wormhole } = await getShieldedTransferInputEntries({
        account,
        srcChainId: body.srcChainId,
        token: body.token,
        tokenId: body.tokenId,
        amount,
      });

      const outputNotes = createShieldedTransferOutputNotes({
        srcChainId: body.srcChainId,
        dstChainId: body.dstChainId,
        sender: account,
        receiver: body.receiver ?? account,
        amount,
        notes: { shielded, wormhole },
      });

      const requestPayload: ShieldedTransferRequest = {
        id: randomUUID(),
        account,
        receiver: body.receiver ?? account,
        token: body.token,
        tokenId: body.tokenId,
        amount: body.amount,
        srcChainId: body.srcChainId,
        dstChainId: body.dstChainId,
        status: "pending",
        shieldedInputNotes: shielded,
        wormholeInputNote: wormhole,
        outputNotes,
      };

      const request = await createShieldedTransferRequest(account, requestPayload);

      res.status(201).json({
        data: {
          request,
          inputNotes: request.shieldedInputNotes,
          wormholeNote: request.wormholeInputNote ?? null,
          outputNotes: request.outputNotes,
        },
      });
    }),
  );

  app.post(
    "/accounts/:account/shielded-transfer-requests/:requestId/status",
    asyncHandler(async (req, res) => {
      const { account, requestId } = parse(requestIdParamsSchema, req.params);
      const body = parse(updateShieldedTransferRequestStatusSchema, req.body);
      const shouldMarkUsed = body.markUsed ?? body.status === "completed";

      const result = await updateShieldedTransferRequestStatus({
        account,
        id: requestId,
        status: body.status,
        markUsed: shouldMarkUsed,
      });

      if (!result) {
        throw new HttpError(404, "Shielded transfer request not found");
      }

      res.json({ data: result });
    }),
  );

  app.post(
    "/accounts/:account/wormhole-notes",
    asyncHandler(async (req, res) => {
      const { account } = parse(accountParamsSchema, req.params);
      const note = parse(wormholeNoteSchema, req.body);
      try {
        const created = await createWormholeNote(account, note);
        res.status(201).json({ data: created });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(409, `Wormhole note ${note.id} already exists for ${account}`);
        }
        throw error;
      }
    }),
  );

  app.post(
    "/accounts/:account/wormhole-notes/batch",
    asyncHandler(async (req, res) => {
      const { account } = parse(accountParamsSchema, req.params);
      const { notes } = parse(wormholeBatchCreateSchema, req.body);
      try {
        const created = await createWormholeNotes(account, notes);
        res.status(201).json({ data: created });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(409, "One or more wormhole notes already exist for this account");
        }
        throw error;
      }
    }),
  );

  app.put(
    "/accounts/:account/wormhole-notes/:id",
    asyncHandler(async (req, res) => {
      const { account, id } = parse(idParamsSchema, req.params);
      const note = parse(wormholeNoteSchema, req.body);
      assertPathId(id, note);
      const updated = await replaceWormholeNote(account, id, note);
      if (!updated) {
        throw new HttpError(404, "Wormhole note not found");
      }
      res.json({ data: updated });
    }),
  );

  app.patch(
    "/accounts/:account/wormhole-notes/:id",
    asyncHandler(async (req, res) => {
      const { account, id } = parse(idParamsSchema, req.params);
      const patch = parse(wormholeNotePatchSchema, req.body);
      const updated = await patchWormholeNote(account, id, patch as Partial<NoteDBWormholeEntry>);
      if (!updated) {
        throw new HttpError(404, "Wormhole note not found");
      }
      res.json({ data: updated });
    }),
  );

  app.delete(
    "/accounts/:account/wormhole-notes/:id",
    asyncHandler(async (req, res) => {
      const { account, id } = parse(idParamsSchema, req.params);
      const deleted = await deleteWormholeNote(account, id);
      if (!deleted) {
        throw new HttpError(404, "Wormhole note not found");
      }
      res.json({ data: deleted });
    }),
  );

  app.use((req, _res, next) => {
    next(new HttpError(404, `Route not found: ${req.method} ${req.path}`));
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: "Invalid request",
        details: error.flatten(),
      });
      return;
    }

    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

async function main() {
  await ensureDatabase();

  const app = createApp();
  const server = app.listen(env.port, env.host, () => {
    console.log(`notes-vault listening on http://${env.host}:${env.port}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down`);
    server.close(async closeError => {
      if (closeError) {
        console.error(closeError);
        process.exitCode = 1;
      }

      try {
        await closeDatabase();
      } catch (databaseError) {
        console.error(databaseError);
        process.exitCode = 1;
      } finally {
        process.exit();
      }
    });
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch(async error => {
  console.error(error);
  await closeDatabase().catch(() => undefined);
  process.exit(1);
});
