import type { Request, Response } from 'express';
import { NovelStatus } from '@prisma/client';
import { prisma } from "../config/prisma.js";

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

/**
 * POST /novels
 * body: { title, description?, authorId, language?, status? }
 *
 * NOTE: authorId here is the Author table's id (authors.id), NOT the
 * user's id — a User only has one Author row if they've set up an
 * author profile. Right now this trusts whatever authorId is passed in
 * the body, same pattern as your other controllers (no auth middleware
 * yet) — once you attach requireAuth to this route, swap this for
 * looking up `prisma.author.findUnique({ where: { userId: req.user.id } })`
 * so people can only create novels under their own author profile.
 */
export const createNovel = async (req: Request, res: Response): Promise<void> => {
    try {
        const { title, description, authorId, language, status } = req.body;

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

        const novel = await prisma.novel.create({
            data: {
                title,
                description,
                authorId,
                slug,
                language: language || "en",
                status: validStatus,
            },
            include: { author: true },
        });

        res.status(201).json(novel);
    } catch (error: any) {
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

        res.json(novels);
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

        res.json(novel);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * PUT /novels/:id
 * body: { title?, description?, language?, status? }
 *
 * Note: this does NOT regenerate the slug when the title changes, on
 * purpose — changing a novel's URL slug after people have already
 * bookmarked/shared it breaks links. Add a separate explicit action
 * later if you want slug changes to be possible.
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

        res.json(novel);
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
 * Same streamifier -> Cloudinary -> save URL pattern as uploadProfilePicture,
 * just pointed at the "covers" folder and novel.coverUrl instead.
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

        res.json(novel);
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