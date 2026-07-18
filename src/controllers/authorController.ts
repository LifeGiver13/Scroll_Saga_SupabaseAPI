import type { Request, Response } from 'express';
import { Role } from '@prisma/client';
import { prisma } from "../config/prisma.js";

function getParamId(req: Request): string | undefined {
    const raw = req.params.id;
    return Array.isArray(raw) ? raw[0] : raw;
}

// Strips passwordHash off the embedded `user` relation before sending
// an author object back to the client.
function sanitizeAuthor(author: any) {
    if (!author) return author;
    if (!author.user) return author;
    const { passwordHash, ...safeUser } = author.user;
    return { ...author, user: safeUser };
}

/**
 * POST /authors
 * body: { userId, penName?, description?, website?, socialLinks? }
 *
 * Creates the author profile AND flips User.role to "author" in one
 * transaction, so the two can't end up out of sync (e.g. an author row
 * existing while role still says "user").
 */
export const createAuthor = async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId, penName, description, website, socialLinks } = req.body;

        if (!userId) {
            res.status(400).json({ error: "userId is required" });
            return;
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            res.status(404).json({ error: "User not found" });
            return;
        }

        const existingAuthor = await prisma.author.findUnique({ where: { userId } });
        if (existingAuthor) {
            res.status(400).json({ error: "This user already has an author profile" });
            return;
        }

        const [author] = await prisma.$transaction([
            prisma.author.create({
                data: { userId, penName, description, website, socialLinks },
                include: { user: true },
            }),
            prisma.user.update({
                where: { id: userId },
                data: { role: Role.author },
            }),
        ]);

        res.status(201).json(sanitizeAuthor(author));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /authors
 * query: ?search= (matches penName)
 */
export const getAuthors = async (req: Request, res: Response): Promise<void> => {
    try {
        const { search } = req.query;

        const authors = await prisma.author.findMany({
            where: search
                ? { penName: { contains: String(search), mode: "insensitive" } } : {},            include: { user: true },
            orderBy: { createdAt: "desc" },
        });

        res.json(authors.map(sanitizeAuthor));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /authors/:id
 */
export const getAuthorById = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParamId(req);

        if (!id) {
            res.status(400).json({ error: "Author id is required in the URL" });
            return;
        }

        const author = await prisma.author.findUnique({
            where: { id },
            include: { user: true, novels: true },
        });

        if (!author) {
            res.status(404).json({ error: "Author not found" });
            return;
        }

        res.json(sanitizeAuthor(author));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /authors/user/:userId
 * Lets the app check "does this user already have an author profile"
 * (e.g. before showing a "Become an Author" vs "Create Novel" button).
 */
export const getAuthorByUserId = async (req: Request, res: Response): Promise<void> => {
    try {
        const raw = req.params.userId;
        const userId = Array.isArray(raw) ? raw[0] : raw;

        if (!userId) {
            res.status(400).json({ error: "userId is required in the URL" });
            return;
        }

        const author = await prisma.author.findUnique({
            where: { userId },
            include: { user: true, novels: true },
        });

        if (!author) {
            res.status(404).json({ error: "This user has no author profile yet" });
            return;
        }

        res.json(sanitizeAuthor(author));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * PUT /authors/:id
 * body: { penName?, description?, website?, socialLinks? }
 */
export const updateAuthor = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParamId(req);

        if (!id) {
            res.status(400).json({ error: "Author id is required in the URL" });
            return;
        }

        const { penName, description, website, socialLinks } = req.body;

        const author = await prisma.author.update({
            where: { id },
            data: {
                ...(penName !== undefined ? { penName } : {}),
                ...(description !== undefined ? { description } : {}),
                ...(website !== undefined ? { website } : {}),
                ...(socialLinks !== undefined ? { socialLinks } : {}),
            },
            include: { user: true },
        });

        res.json(sanitizeAuthor(author));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * DELETE /authors/:id
 *
 * IMPORTANT (per your schema): Novel.author has onDelete: Cascade, so
 * deleting an Author row deletes every novel (and every chapter, review,
 * etc. under those novels) that author owns. That's expected behavior
 * given how the schema is defined, not a bug — just make sure whatever
 * UI calls this warns the person clearly first.
 *
 * Also resets the user's role back to "user" in the same transaction.
 */
export const deleteAuthor = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParamId(req);

        if (!id) {
            res.status(400).json({ error: "Author id is required in the URL" });
            return;
        }

        const author = await prisma.author.findUnique({ where: { id } });
        if (!author) {
            res.status(404).json({ error: "Author not found" });
            return;
        }

        await prisma.$transaction([
            prisma.author.delete({ where: { id } }),
            prisma.user.update({
                where: { id: author.userId },
                data: { role: Role.user },
            }),
        ]);

        res.json({ message: "Author profile deleted." });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};