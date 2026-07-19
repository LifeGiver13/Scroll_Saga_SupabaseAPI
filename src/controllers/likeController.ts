import type { Request, Response } from 'express';
import { prisma } from "../config/prisma.js";

function getParam(req: Request, key: string): string | undefined {
    const raw = req.params[key];
    return Array.isArray(raw) ? raw[0] : raw;
}

const VALID_TARGET_TYPES = ["chapter", "comment", "review"];

/**
 * POST /likes/:targetType/:targetId
 * body: { userId }
 *
 * Chapter has no denormalized like counter in the schema (just the Like
 * relation itself), but Review and Comment both also have a `likes` Int
 * column — those get incremented in the same transaction so the count
 * on the row stays in sync with the actual Like rows.
 */
export const likeTarget = async (req: Request, res: Response): Promise<void> => {
    try {
        const targetType = getParam(req, "targetType");
        const targetId = getParam(req, "targetId");
        const { userId } = req.body;

        if (!targetType || !targetId || !userId) {
            res.status(400).json({ error: "targetType, targetId (in URL) and userId (in body) are required" });
            return;
        }

        if (!VALID_TARGET_TYPES.includes(targetType)) {
            res.status(400).json({ error: `targetType must be one of: ${VALID_TARGET_TYPES.join(", ")}` });
            return;
        }

        const existing = await prisma.like.findUnique({
            where: { userId_targetType_targetId: { userId, targetType, targetId } },
        });

        if (existing) {
            res.status(400).json({ error: "Already liked" });
            return;
        }

        const operations: any[] = [
            prisma.like.create({ data: { userId, targetType, targetId } }),
        ];

        if (targetType === "review") {
            operations.push(
                prisma.review.update({ where: { id: targetId }, data: { likes: { increment: 1 } } })
            );
        } else if (targetType === "comment") {
            operations.push(
                prisma.comment.update({ where: { id: targetId }, data: { likes: { increment: 1 } } })
            );
        }

        const [like] = await prisma.$transaction(operations);

        res.status(201).json(like);
    } catch (error: any) {
        if (error.code === "P2003") {
            res.status(404).json({ error: "That chapter/comment/review doesn't exist" });
            return;
        }
        res.status(500).json({ error: error.message });
    }
};

/**
 * DELETE /likes/:targetType/:targetId?userId=
 */
export const unlikeTarget = async (req: Request, res: Response): Promise<void> => {
    try {
        const targetType = getParam(req, "targetType");
        const targetId = getParam(req, "targetId");
        const userId = req.query.userId ? String(req.query.userId) : undefined;

        if (!targetType || !targetId || !userId) {
            res.status(400).json({ error: "targetType, targetId (in URL) and userId (query param) are required" });
            return;
        }

        const existing = await prisma.like.findUnique({
            where: { userId_targetType_targetId: { userId, targetType, targetId } },
        });

        if (!existing) {
            res.status(404).json({ error: "Like not found" });
            return;
        }

        const operations: any[] = [prisma.like.delete({ where: { id: existing.id } })];

        if (targetType === "review") {
            operations.push(
                prisma.review.update({ where: { id: targetId }, data: { likes: { decrement: 1 } } })
            );
        } else if (targetType === "comment") {
            operations.push(
                prisma.comment.update({ where: { id: targetId }, data: { likes: { decrement: 1 } } })
            );
        }

        await prisma.$transaction(operations);

        res.json({ message: "Like removed." });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /likes/:targetType/:targetId?userId=
 * Returns the total like count, and (if userId is given) whether that
 * specific user has liked it — enough for a UI to render a filled vs
 * outline heart icon plus a count, in one request.
 */
export const getLikeStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const targetType = getParam(req, "targetType");
        const targetId = getParam(req, "targetId");
        const userId = req.query.userId ? String(req.query.userId) : undefined;

        if (!targetType || !targetId) {
            res.status(400).json({ error: "targetType and targetId are required in the URL" });
            return;
        }

        const count = await prisma.like.count({ where: { targetType, targetId } });

        let likedByUser = false;
        if (userId) {
            const existing = await prisma.like.findUnique({
                where: { userId_targetType_targetId: { userId, targetType, targetId } },
            });
            likedByUser = Boolean(existing);
        }

        res.json({ count, likedByUser });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};