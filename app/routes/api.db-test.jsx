import { json } from "@remix-run/node";
import prisma from "../db.server";

export const loader = async () => {
  const results = {
    databaseUrl: process.env.DATABASE_URL
      ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ":****@")
      : "NOT SET",
    directUrl: process.env.DIRECT_URL
      ? process.env.DIRECT_URL.replace(/:[^:@]+@/, ":****@")
      : "NOT SET",
  };

  try {
    const count = await prisma.$queryRaw`SELECT 1 as test`;
    results.connection = "SUCCESS";
    results.query = count;
  } catch (error) {
    results.connection = "FAILED";
    results.errorName = error.constructor.name;
    results.errorMessage = error.message;
    results.errorCode = error.code;
  }

  try {
    const sessionCount = await prisma.session.count();
    results.sessionTable = "EXISTS";
    results.sessionCount = sessionCount;
  } catch (error) {
    results.sessionTable = "FAILED";
    results.sessionError = error.message;
  }

  return json(results, { status: results.connection === "SUCCESS" ? 200 : 500 });
};
