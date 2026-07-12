import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import 'dotenv/config';

export interface TokenPayload {
  id: string;
}

export const generateToken = (userId: string): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not defined in environment variables");
  }

  // Cast the entire options object directly to SignOptions.
  // This bypasses the strict literal check while keeping your code 100% type-safe.
  const options = {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  } as SignOptions;

  return jwt.sign({ id: userId }, secret, options);
};

export const verifyToken = (token: string): TokenPayload => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined in environment variables");
  }
  return jwt.verify(token, process.env.JWT_SECRET) as TokenPayload;
};
