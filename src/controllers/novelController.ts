import type { Request, Response } from 'express';
import { NovelStatus } from '@prisma/client';
import { prisma } from "../config/prisma.js";
import { serializeBigInts } from "../utils/serializeBigInts.js";

import streamifier from "streamifier";
import cloudinary from "../config/cloudinary.js";

// req.params values can type as `string | string[]` (Express allows
// repeatable route segments), so we normalize to a single string here
// once, instead of repeating this in every function below.
function getParam(req: Request, key: string): string | undefined {
    const raw = req.params[key];
    return Array.isArray(raw) ? raw[0] : raw;
}

function slugify(title: string): string {
    return title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}

// Appends -2, -3, etc. until it finds a slug that isn't taken yet.
async function generateUniqueSlug(title: string): Promise<string> {
    const base = slugify(title) || "novel";
    let slug = base;
    let counter = 1;

    while (await prisma.novel.findUnique({ where: { slug } })) {
        counter += 1;
        slug = `${base}-${counter}`;
    }

    return slug;
}

// Genre/tag ids can arrive as a JSON-stringified array (recommended for
// a multipart form: JSON.stringify(selectedIds) as one text field),
// a comma-separated string, or an actual array (if the client appends
// the same field name multiple times). Handles all three.
function parseIdList(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed.map(String);
        } catch {
            // not JSON — fall through to comma-separated parsing
        }
        return value.split(",").map((v) => v.trim()).filter(Boolean);
    }
    return [];
}

/**
 * POST /novels
 * multipart/form-data fields: title, description?, authorId, language?,
 * status?, genreIds? (JSON array string, e.g. '["id1","id2"]'), tagIds?
 * (same shape), and an optional file field named "cover".
 *
 * Cover, genres, and tags can all be attached in this single request now
 * instead of requiring separate follow-up calls after creation. The
 * cover uploads to Cloudinary first (so its URL can go straight into the
 * insert), and genres/tags use Prisma's nested-create so the join rows
 * (NovelGenre/NovelTag) are created atomically with the novel itself.
 */
export const createNovel = async (req: Request, res: Response): Promise<void> => {
    try {
        const { title, description, authorId, language, status } = req.body;
        const genreIds = parseIdList(req.body.genreIds);
        const tagIds = parseIdList(req.body.tagIds);

        if (!title || !authorId) {
            res.status(400).json({ error: "title and authorId are required" });
            return;
        }

        const author = await prisma.author.findUnique({ where: { id: authorId } });
        if (!author) {
            res.status(404).json({ error: "Author not found. Create an author profile first." });
            return;
        }

        const slug = await generateUniqueSlug(title);

        const validStatus = Object.values(NovelStatus).includes(status)
            ? (status as NovelStatus)
            : NovelStatus.ongoing;

        let coverUrl: string | undefined;
        if (req.file) {
            const result = await new Promise<any>((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    { folder: "covers" },
                    (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    }
                );
                streamifier.createReadStream(req.file!.buffer).pipe(stream);
            });
            coverUrl = result.secure_url;
        }

        const novel = await prisma.novel.create({
            data: {
                title,
                description,
                authorId,
                slug,
                language: language || "en",
                status: validStatus,
                ...(coverUrl ? { coverUrl } : {}),
                ...(genreIds.length
                    ? { genres: { create: genreIds.map((genreId) => ({ genreId })) } }
                    : {}),
                ...(tagIds.length
                    ? { tags: { create: tagIds.map((tagId) => ({ tagId })) } }
                    : {}),
            },
            include: {
                author: true,
                genres: { include: { genre: true } },
                tags: { include: { tag: true } },
            },
        });

        res.status(201).json(serializeBigInts(novel));
    } catch (error: any) {
        if (error.code === "P2003") {
            res.status(400).json({ error: "One of the provided genreIds/tagIds doesn't exist" });
            return;
        }
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /novels/:id/view
 *
 * Deliberately a separate endpoint rather than bumping views inside
 * getNovelById — GET requests shouldn't have side effects, and this way
 * the admin dashboard opening a novel's edit form doesn't silently
 * inflate its view count. Only the reader app should call this, when
 * someone actually opens a novel to read it.
 */
export const incrementNovelView = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParam(req, "id");

        if (!id) {
            res.status(400).json({ error: "Novel id is required in the URL" });
            return;
        }

        const novel = await prisma.novel.update({
            where: { id },
            data: { views: { increment: 1 } },
            select: { id: true, views: true },
        });

        res.json(serializeBigInts(novel));
    } catch (error: any) {
        if (error.code === "P2025") {
            res.status(404).json({ error: "Novel not found" });
            return;
        }
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /novels
 * query: ?authorId=&status=&search=
 */
export const getNovels = async (req: Request, res: Response): Promise<void> => {
    try {
        const { authorId, status, search } = req.query;

        const novels = await prisma.novel.findMany({
            where: {
                ...(authorId ? { authorId: String(authorId) } : {}),
                ...(status ? { status: status as NovelStatus } : {}),
                ...(search
                    ? { title: { contains: String(search), mode: "insensitive" as const } }
                    : {}),
            },
            include: { author: true },
            orderBy: { createdAt: "desc" },
        });

        res.json(serializeBigInts(novels));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /novels/:id
 */
export const getNovelById = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParam(req, "id");

        if (!id) {
            res.status(400).json({ error: "Novel id is required in the URL" });
            return;
        }

        const novel = await prisma.novel.findUnique({
            where: { id },
            include: {
                author: true,
                chapters: { orderBy: { chapterNumber: "asc" } },
                genres: { include: { genre: true } },
                tags: { include: { tag: true } },
            },
        });

        if (!novel) {
            res.status(404).json({ error: "Novel not found" });
            return;
        }

        res.json(serializeBigInts(novel));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * PUT /novels/:id
 * body: { title?, description?, language?, status? }
 */
export const updateNovel = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParam(req, "id");

        if (!id) {
            res.status(400).json({ error: "Novel id is required in the URL" });
            return;
        }

        const { title, description, language, status } = req.body;

        const novel = await prisma.novel.update({
            where: { id },
            data: {
                ...(title !== undefined ? { title } : {}),
                ...(description !== undefined ? { description } : {}),
                ...(language !== undefined ? { language } : {}),
                ...(status !== undefined ? { status } : {}),
            },
            include: { author: true },
        });

        res.json(serializeBigInts(novel));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * DELETE /novels/:id
 */
export const deleteNovel = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParam(req, "id");

        if (!id) {
            res.status(400).json({ error: "Novel id is required in the URL" });
            return;
        }

        await prisma.novel.delete({ where: { id } });

        res.json({ message: "Novel deleted." });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * PUT /novels/:id/cover
 * multipart field name: "cover"
 */
export const uploadNovelCover = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParam(req, "id");

        if (!id) {
            res.status(400).json({ error: "Novel id is required in the URL" });
            return;
        }

        if (!req.file) {
            res.status(400).json({ error: "No image uploaded" });
            return;
        }

        const result = await new Promise<any>((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: "covers" },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );

            streamifier.createReadStream(req.file!.buffer).pipe(stream);
        });

        const novel = await prisma.novel.update({
            where: { id },
            data: { coverUrl: result.secure_url },
        });

        res.json(serializeBigInts(novel));
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST /novels/:id/genres
 * body: { genreId }
 */
export const attachGenreToNovel = async (req: Request, res: Response): Promise<void> => {
    try {
        const novelId = getParam(req, "id");
        const { genreId } = req.body;

        if (!novelId || !genreId) {
            res.status(400).json({ error: "novel id (in URL) and genreId (in body) are required" });
            return;
        }

        const alreadyAttached = await prisma.novelGenre.findUnique({
            where: { novelId_genreId: { novelId, genreId } },
        });
        if (alreadyAttached) {
            res.status(400).json({ error: "That genre is already attached to this novel" });
            return;
        }

        const novelGenre = await prisma.novelGenre.create({
            data: { novelId, genreId },
            include: { genre: true },
        });

        res.status(201).json(novelGenre);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * DELETE /novels/:id/genres/:genreId
 */
export const removeGenreFromNovel = async (req: Request, res: Response): Promise<void> => {
    try {
        const novelId = getParam(req, "id");
        const genreId = getParam(req, "genreId");

        if (!novelId || !genreId) {
            res.status(400).json({ error: "novel id and genre id are required in the URL" });
            return;
        }

        await prisma.novelGenre.delete({
            where: { novelId_genreId: { novelId, genreId } },
        });

        res.json({ message: "Genre removed from novel." });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /novels/:id/tags
 * body: { tagId }
 */
export const attachTagToNovel = async (req: Request, res: Response): Promise<void> => {
    try {
        const novelId = getParam(req, "id");
        const { tagId } = req.body;

        if (!novelId || !tagId) {
            res.status(400).json({ error: "novel id (in URL) and tagId (in body) are required" });
            return;
        }

        const alreadyAttached = await prisma.novelTag.findUnique({
            where: { novelId_tagId: { novelId, tagId } },
        });
        if (alreadyAttached) {
            res.status(400).json({ error: "That tag is already attached to this novel" });
            return;
        }

        const novelTag = await prisma.novelTag.create({
            data: { novelId, tagId },
            include: { tag: true },
        });

        res.status(201).json(novelTag);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * DELETE /novels/:id/tags/:tagId
 */
export const removeTagFromNovel = async (req: Request, res: Response): Promise<void> => {
    try {
        const novelId = getParam(req, "id");
        const tagId = getParam(req, "tagId");

        if (!novelId || !tagId) {
            res.status(400).json({ error: "novel id and tag id are required in the URL" });
            return;
        }

        await prisma.novelTag.delete({
            where: { novelId_tagId: { novelId, tagId } },
        });

        res.json({ message: "Tag removed from novel." });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};