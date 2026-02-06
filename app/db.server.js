import { PrismaClient } from "@prisma/client";

/** @type {PrismaClient} */
let prisma;

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  // Reuse client in development to avoid too many connections
  if (!global.__prisma) {
    global.__prisma = new PrismaClient();
  }
  prisma = global.__prisma;
}

export default prisma;
