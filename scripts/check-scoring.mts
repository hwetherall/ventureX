/**
 * Stage 6 scoring dry-run (prompt-iteration loop).
 *
 * Runs the real orchestrator against a live venture's researched cells but
 * skips the candidate_companies writes unless --write is passed. Useful for
 * iterating prompts/stage_6_candidate_scoring.md without touching data.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/check-scoring.ts <venture_id> [--write]
 *
 * Auth: signs in with VENTUREX_EMAIL + VENTUREX_PASSWORD when both are set
 * (RLS scopes reads to that user); otherwise falls back to INSFORGE_API_KEY
 * (admin, bypasses RLS — the "reserved for ops" key from .env.example, and a
 * CLI dry-run is exactly ops).
 */

import { createClient } from "@insforge/sdk";

import { runStage6Scoring } from "@/server/stage6-score";
import { DIMENSION_KEYS } from "@/types/candidate-scoring";

async function makeClient() {
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL!;
  const anonKey =
    process.env.INSFORGE_ANON_KEY ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!;

  const email = process.env.VENTUREX_EMAIL;
  const password = process.env.VENTUREX_PASSWORD;
  if (email && password) {
    const anon = createClient({ baseUrl, anonKey, isServerMode: true });
    const { data: session, error } = await anon.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !session?.accessToken) {
      console.error(`Sign-in failed: ${error?.message ?? "no session"}`);
      process.exit(1);
    }
    return createClient({
      baseUrl,
      anonKey,
      isServerMode: true,
      edgeFunctionToken: session.accessToken,
    });
  }

  const adminKey = process.env.INSFORGE_API_KEY;
  if (adminKey) {
    console.log("(using INSFORGE_API_KEY admin access — RLS bypassed)\n");
    return createClient({ baseUrl, anonKey: adminKey, isServerMode: true });
  }

  console.error(
    "Set VENTUREX_EMAIL + VENTUREX_PASSWORD (preferred) or INSFORGE_API_KEY in the env file.",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--write");
  const write = process.argv.includes("--write");
  const ventureId = args[0];

  if (!ventureId) {
    console.error(
      "Usage: pnpm tsx --env-file=.env.local scripts/check-scoring.ts <venture_id> [--write]",
    );
    process.exit(1);
  }

  const insforge = await makeClient();

  console.log(
    `Running Stage 6 scoring for venture ${ventureId} (${write ? "WRITE" : "dry-run"})…\n`,
  );
  const startedAt = Date.now();
  const result = await runStage6Scoring({
    ventureId,
    insforge,
    dryRun: !write,
  });

  if (!result.ok) {
    console.error(`FAILED: ${result.error}`);
    process.exit(2);
  }

  const ranked = [...result.scored].sort(
    (a, b) => b.aggregateScore - a.aggregateScore,
  );
  console.log("rank  aggregate  candidate");
  ranked.forEach((entry, index) => {
    console.log(
      `${String(index + 1).padStart(4)}  ${entry.aggregateScore.toFixed(3).padStart(9)}  ${entry.name}`,
    );
  });

  console.log("\nPer-dimension detail:");
  for (const entry of ranked) {
    const dims = DIMENSION_KEYS.map(
      (dim) => `${dim}=${entry.output.dimension_scores[dim].score}`,
    ).join(" ");
    console.log(`- ${entry.name}: ${dims}`);
    for (const dim of DIMENSION_KEYS) {
      const cell = entry.output.dimension_scores[dim];
      console.log(
        `    ${dim} [${cell.score}/5, conf ${cell.confidence}]: ${cell.rationale}`,
      );
    }
  }

  if (result.skipped.length > 0) {
    console.log(`\nSkipped (${result.skipped.length}):`);
    for (const entry of result.skipped) {
      console.log(`- ${entry.name}: ${entry.reason}`);
    }
  }
  if (result.failed.length > 0) {
    console.log(`\nFailed (${result.failed.length}):`);
    for (const entry of result.failed) {
      console.log(`- ${entry.name}: ${entry.error}`);
    }
  }

  console.log(
    `\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — scored ${result.scored.length}, skipped ${result.skipped.length}, failed ${result.failed.length}, cost $${result.costUsd.toFixed(3)}${write ? " (written)" : " (dry-run, nothing written)"}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
