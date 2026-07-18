import type { Request, Response } from 'express';
import { prisma } from "../config/prisma.js";

function getParamId(req: Request): string | undefined {
    const raw = req.params.id;
    return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * GET /genres
 * query: ?search=
 */
export const getGenres = async (req: Request, res: Response): Promise<void> => {
    try {
        const { search } = req.query;

        const genres = await prisma.genre.findMany({
            where: search
                ? { name: { contains: String(search), mode: "insensitive" } } : {},
            orderBy: { name: "asc" },
        });

        res.json(genres);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /genres
 * body: { name }
 */
export const createGenre = async (req: Request, res: Response): Promise<void> => {
    try {
        const { name } = req.body;

        if (!name) {
            res.status(400).json({ error: "name is required" });
            return;
        }

        const existing = await prisma.genre.findUnique({ where: { name } });
        if (existing) {
            res.status(400).json({ error: "That genre already exists" });
            return;
        }

        const genre = await prisma.genre.create({ data: { name } });

        res.status(201).json(genre);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * DELETE /genres/:id
 * Cascades to remove it from any novel it was attached to
 * (novel_genres.genreId has onDelete: Cascade).
 */
export const deleteGenre = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = getParamId(req);

        if (!id) {
            res.status(400).json({ error: "Genre id is required in the URL" });
            return;
        }

        await prisma.genre.delete({ where: { id } });

        res.json({ message: "Genre deleted." });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};