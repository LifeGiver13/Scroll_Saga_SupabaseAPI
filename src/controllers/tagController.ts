import type { Request, Response } from 'express';
import { prisma } from "../config/prisma.js";

function getParamId(req: Request): string | undefined {
    const raw = req.params.id;
    return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * GET /tags
 * query: ?search=
 */
export const getTags = async (req: Request, res: Response): Promise<void> => {
    try {
        const { search } = req.query;

        const tags = await prisma.tag.findMany({
            // Passing an empty object `{}` tells Prisma to fetch all records
            where: search
                ? { name: { contains: String(search), mode: "insensitive" } }
                : {},
            orderBy: { name: "asc" },
        });

        res.json(tags);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /tags
 * body: { name }
 *
 * Note: unlike Genre, Tag.name has no @unique in your schema — so
 * duplicates ("Dragon" twice) are technically allowed. Still checking
 * here to avoid an obviously-duplicate tag from casual reuse, but if
 * you want this enforced at the DB level too, add @unique to Tag.name.
 */
export const createTag = async (req: Request, res: Response): Promise<void> => {
    try {
        const { name } = req.body;

        if (!name) {
            res.status(400).json({ error: "name is required" });
            return;
        }

        const existing = await prisma.tag.findFirst({ where: { name } });
        if (existing) {
            res.status(400).json({ error: "That tag already exists" });
            return;
        }

        const tag = await prisma.tag.create({ data: { name } });

        res.status(201).json(tag);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * DELETE /tags/:id
 */
export const deleteTag = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParamId(req);

        if (!id) {
            res.status(400).json({ error: "Tag id is required in the URL" });
            return;
        }

        await prisma.tag.delete({ where: { id } });

        res.json({ message: "Tag deleted." });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};