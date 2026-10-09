"use client";

import type { Status } from "@arogya/contracts/generated/ArogyaResponse";
import { copy } from "@/lib/copy";

interface StatusBadgeProps {
  status: Status;
  locale: "en" | "ne" | "tam";
}

export function StatusBadge({ status, locale }: StatusBadgeProps) {
  const text = copy[locale === "ne" ? "ne" : "en"];

  switch (status) {
    case "answered":
      return (
        <span className="status-badge status-answered" role="status">
          ✓ {text.statusAnswered}
        </span>
      );
    case "needs_clarification":
      return (
        <span className="status-badge status-clarification" role="status">
          ? {text.statusClarification}
        </span>
      );
    case "needs_professional_review":
      return (
        <span className="status-badge status-review" role="status">
          ⚕ {text.statusProfessionalReview}
        </span>
      );
    case "urgent":
      return (
        <span className="status-badge status-urgent" role="alert">
          ⚠ {text.statusUrgent}
        </span>
      );
    default:
      return (
        <span className="status-badge status-unavailable" role="status">
          ✕ {text.statusUnavailable}
        </span>
      );
  }
}
