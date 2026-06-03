"use client";

import * as React from "react";
import { IconArrowUp, IconPlayerStopFilled } from "@tabler/icons-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type SendButtonProps = {
  state: "idle" | "typing" | "streaming";
};

export function SendButton({ state }: SendButtonProps) {
  const isStreaming = state === "streaming";
  const isTyping = state === "typing";

  if (isStreaming) {
    return (
      <div className="size-7 rounded-full bg-neutral-900 dark:bg-neutral-100 flex items-center justify-center cursor-pointer">
        <IconPlayerStopFilled className="size-4 text-white dark:text-neutral-900" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "size-7 rounded-full flex items-center justify-center",
        isTyping
          ? "bg-blue-500 dark:bg-blue-400 cursor-pointer"
          : "bg-neutral-100 dark:bg-neutral-800 cursor-default",
      )}
    >
      <IconArrowUp
        className={cn(
          "size-4",
          isTyping
            ? "text-white dark:text-neutral-900"
            : "text-neutral-400 dark:text-neutral-600",
        )}
      />
    </div>
  );
}
