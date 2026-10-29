import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { loadAdminData, parseFilters, sortForExport } from "@/lib/admin-data";
import { STATUS_LABEL } from "@/lib/registrations";

export const dynamic = "force-dynamic";

// Semikolon + BOM: åpnes riktig i norsk Excel (med æøå), og Google Sheets
// gjenkjenner skilletegnet automatisk ved import.
const SEP = ";";

function cell(value: string): string {
  // Hindrer formel-injeksjon i Excel (=, +, -, @ i starten av en celle).
  let v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[";\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }
  const filters = parseFilters(Object.fromEntries(req.nextUrl.searchParams));
  const { rows } = await loadAdminData(filters);

  const lines = [
    ["navn", "klasse", "mobil", "epost", "status", "betalt"].join(SEP),
    ...sortForExport(rows).map((r) =>
      [r.full_name, r.class_name, r.phone, r.email, STATUS_LABEL[r.status].toLowerCase(), r.paid ? "ja" : "nei"]
        .map(cell)
        .join(SEP),
    ),
  ];

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pameldinger-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
