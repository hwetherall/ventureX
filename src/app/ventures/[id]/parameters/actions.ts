"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/insforge/auth";
import { createAuthedServerClient } from "@/lib/insforge/server";
import { runStage4ParameterBuilder } from "@/server/stage4-parameters";

export type TriggerParameterGenerationResult =
  | {
      ok: true;
      parameterRunId: string;
      dynamicParameterCount: number;
      fullParameterCount: number;
      costUsd: number;
    }
  | { ok: false; error: string };

export async function triggerParameterGeneration(args: {
  ventureId: string;
}): Promise<TriggerParameterGenerationResult> {
  await requireUser();

  const ventureId = args.ventureId.trim();
  if (!ventureId) {
    return { ok: false, error: "Missing ventureId." };
  }

  const insforge = await createAuthedServerClient();
  const result = await runStage4ParameterBuilder({ ventureId, insforge });

  if (!result.ok) {
    revalidatePath(`/ventures/${ventureId}`);
    return { ok: false, error: result.error };
  }

  redirect(`/ventures/${ventureId}/parameters`);
}
