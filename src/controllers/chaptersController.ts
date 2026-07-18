import type { Request, Response } from 'express';
import { prisma } from "../config/prisma.js";
import { serializeBigInts } from '../utils/serializeBigInts.js';

function getParam(req: Request, key: string): string | undefined {
    const raw = req.params[key];
    return Array.isArray(raw) ? raw[0] : raw;
}

function countWords(content?: string | null): number {
    if (!content) return 0;
    return content.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * POST /novels/:novelId/chapters
 * body: { title, content?, chapterNumber?, isLocked?, premiumPrice?, publishedAt? }
 *
 * chapterNumber is optional — if omitted, it's set to (highest existing
 * chapter number for this novel) + 1. wordCount is computed from content,
 * not trusted from the client. Keeps Novel.chapterCount in sync via a
 * transaction (that field is a manually-maintained counter, not computed
 * on read, so it has to be bumped here).
 */
export const createChapter = async (req: Request, res: Response): Promise<void> => {
    try {
        const novelId = getParam(req, "novelId");

        if (!novelId) {
            res.status(400).json({ error: "novel id is required in the URL" });
            return;
        }

        const novel = await prisma.novel.findUnique({ where: { id: novelId } });
        if (!novel) {
            res.status(404).json({ error: "Novel not found" });
            return;
        }

        const { title, content, isLocked, premiumPrice, publishedAt } = req.body;
        let { chapterNumber } = req.body;

        if (!title) {
            res.status(400).json({ error: "title is required" });
            return;
        }

        if (chapterNumber === undefined || chapterNumber === null) {
            const lastChapter = await prisma.chapter.findFirst({
                where: { novelId },
                orderBy: { chapterNumber: "desc" },
            });
            chapterNumber = lastChapter ? lastChapter.chapterNumber + 1 : 1;
        }

        const existing = await prisma.chapter.findUnique({
            where: { novelId_chapterNumber: { novelId, chapterNumber } },
        });
        if (existing) {
            res.status(400).json({ error: `Chapter ${chapterNumber} already exists for this novel` });
            return;
        }

        const [chapter] = await prisma.$transaction([
            prisma.chapter.create({
                data: {
                    novelId,
                    chapterNumber,
                    title,
                    content,
                    wordCount: countWords(content),
                    isLocked: Boolean(isLocked),
                    premiumPrice: premiumPrice ?? null,
                    publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
                },
            }),
            prisma.novel.update({
                where: { id: novelId },
                data: { chapterCount: { increment: 1 } },
            }),
        ]);

        res.status(201).json(serializeBigInts(chapter));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /novels/:novelId/chapters?full=true
 * Lightweight by default (no `content` field, so a chapter list doesn't
 * ship the entire text of every chapter). Pass ?full=true to include it.
 */
export const getChaptersByNovel = async (req: Request, res: Response): Promise<void> => {
    try {
        const novelId = getParam(req, "novelId");

        if (!novelId) {
            res.status(400).json({ error: "novel id is required in the URL" });
            return;
        }

        const includeContent = req.query.full === "true";

        const chapters = await prisma.chapter.findMany({
            where: { novelId },
            orderBy: { chapterNumber: "asc" },
            select: {
                id: true,
                novelId: true,
                chapterNumber: true,
                title: true,
                wordCount: true,
                isLocked: true,
                premiumPrice: true,
                views: true,
                publishedAt: true,
                createdAt: true,
                ...(includeContent ? { content: true } : {}),
            },
        });

        res.json(serializeBigInts(chapters));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /chapters/:id?userId=
 *
 * Bumps the view count on every read. If the chapter is locked, content
 * is only included when ?userId= is provided AND that user has a
 * ChapterAccess row — otherwise everything comes back except `content`
 * (so the app can still show title/word count/"unlock for $X" UI without
 * leaking the text). No auth middleware exists yet, so userId is trusted
 * from the query string for now — swap for req.user.id once that's wired up.
 */
export const getChapterById = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParam(req, "id");

        if (!id) {
            res.status(400).json({ error: "Chapter id is required in the URL" });
            return;
        }

        let chapter;
        try {
            // Single round-trip: this both fetches the current row and
            // bumps the view count via the update's returned value.
            chapter = await prisma.chapter.update({
                where: { id },
                data: { views: { increment: 1 } },
            });
        } catch (err: any) {
            if (err.code === "P2025") {
                res.status(404).json({ error: "Chapter not found" });
                return;
            }
            throw err;
        }

        if (!chapter.isLocked) {
            res.json(serializeBigInts({ ...chapter, hasAccess: true }));
            return;
        }

        const userId = req.query.userId ? String(req.query.userId) : undefined;
        let hasAccess = false;

        if (userId) {
            const access = await prisma.chapterAccess.findUnique({
                where: { userId_chapterId: { userId, chapterId: id } },
            });
            hasAccess = Boolean(access);
        }

        if (!hasAccess) {
            const { content, ...preview } = chapter;
            res.json(serializeBigInts({ ...preview, content: null, hasAccess: false }));
            return;
        }

        res.json(serializeBigInts({ ...chapter, hasAccess: true }));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * PUT /chapters/:id
 * body: { title?, content?, chapterNumber?, isLocked?, premiumPrice? }
 * wordCount is recomputed automatically whenever content changes.
 */
export const updateChapter = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParam(req, "id");

        if (!id) {
            res.status(400).json({ error: "Chapter id is required in the URL" });
            return;
        }

        const { title, content, isLocked, premiumPrice, chapterNumber } = req.body;

        const data: Record<string, unknown> = {};
        if (title !== undefined) data.title = title;
        if (content !== undefined) {
            data.content = content;
            data.wordCount = countWords(content);
        }
        if (isLocked !== undefined) data.isLocked = Boolean(isLocked);
        if (premiumPrice !== undefined) data.premiumPrice = premiumPrice;
        if (chapterNumber !== undefined) data.chapterNumber = chapterNumber;

        const chapter = await prisma.chapter.update({ where: { id }, data });

        res.json(serializeBigInts(chapter));
    } catch (error: any) {
        if (error.code === "P2002") {
            res.status(400).json({ error: "Another chapter already uses that chapter number for this novel" });
            return;
        }
        res.status(500).json({ error: error.message });
    }
};

/**
 * DELETE /chapters/:id
 * Keeps Novel.chapterCount in sync (decrements it in the same transaction).
 */
export const deleteChapter = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParam(req, "id");

        if (!id) {
            res.status(400).json({ error: "Chapter id is required in the URL" });
            return;
        }

        const chapter = await prisma.chapter.findUnique({ where: { id } });
        if (!chapter) {
            res.status(404).json({ error: "Chapter not found" });
            return;
        }

        await prisma.$transaction([
            prisma.chapter.delete({ where: { id } }),
            prisma.novel.update({
                where: { id: chapter.novelId },
                data: { chapterCount: { decrement: 1 } },
            }),
        ]);

        res.json({ message: "Chapter deleted." });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * PUT /chapters/:id/publish
 * Sets publishedAt to now — for chapters created with a null/future
 * publishedAt that an author wants to release immediately.
 */
export const publishChapter = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParam(req, "id");

        if (!id) {
            res.status(400).json({ error: "Chapter id is required in the URL" });
            return;
        }

        const chapter = await prisma.chapter.update({
            where: { id },
            data: { publishedAt: new Date() },
        });

        res.json(serializeBigInts(chapter));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /chapters/:id/access
 * body: { userId }
 * Manually grants a user access to a locked chapter — useful for admin
 * "comp this reader a chapter" actions, or for wiring up later once a
 * real payment flow exists. Upserts so granting twice is a no-op, not
 * an error.
 */
export const grantChapterAccess = async (req: Request, res: Response): Promise<void> => {
    try {
        const chapterId = getParam(req, "id");
        const { userId } = req.body;

        if (!chapterId || !userId) {
            res.status(400).json({ error: "chapter id (URL) and userId (body) are required" });
            return;
        }

        const access = await prisma.chapterAccess.upsert({
            where: { userId_chapterId: { userId, chapterId } },
            update: {},
            create: { userId, chapterId },
        });

        res.status(201).json(access);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /chapters/:id/access/:userId
 * Lets the app check "can this user read this chapter" without pulling
 * the whole chapter (e.g. to decide whether to show a lock icon before
 * the reader taps in).
 */
export const checkChapterAccess = async (req: Request, res: Response): Promise<void> => {
    try {
        const chapterId = getParam(req, "id");
        const userId = getParam(req, "userId");

        if (!chapterId || !userId) {
            res.status(400).json({ error: "chapter id and user id are required in the URL" });
            return;
        }

        const access = await prisma.chapterAccess.findUnique({
            where: { userId_chapterId: { userId, chapterId } },
        });

        res.json({ hasAccess: Boolean(access) });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};