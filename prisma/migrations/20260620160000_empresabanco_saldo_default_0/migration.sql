-- saldoActual nunca null: evita que increment/decrement (null + n = null) pierda
-- cobros del barrido cuando la cuenta tenía saldo null. Backfill + default 0.
UPDATE "EmpresaBanco" SET "saldoActual" = 0 WHERE "saldoActual" IS NULL;
ALTER TABLE "EmpresaBanco" ALTER COLUMN "saldoActual" SET DEFAULT 0;
