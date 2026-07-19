// Prisma returns BigInt columns (like `views`) as JS `bigint`, and
// JSON.stringify — which res.json() uses under the hood — throws a
// TypeError on any bigint. This round-trips through JSON.stringify's
// replacer to convert every bigint to a string first.
export function serializeBigInts<T>(data: T): T {
    return JSON.parse(
        JSON.stringify(data, (_, value) =>
            typeof value === "bigint" ? value.toString() : value
        )
    );
}