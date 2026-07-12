import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt.js";
import type { TokenPayload } from "../utils/jwt.js";

// augment Express's Request type so `req.user` is typed everywhere
declare global {
    namespace Express {
        interface Request {
            user?: TokenPayload;
        }
    }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or malformed Authorization header" });
        return;
    }

    const token = header.slice("Bearer ".length);

    try {
        req.user = verifyToken(token);
        next();
    } catch {
        res.status(401).json({ error: "Invalid or expired token" });
    }
}