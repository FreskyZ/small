const points = [
    { x: -1, y: -1 },
    { x: -1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: 1, y: -1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
];

for (const [p1, i] of points.map<[{ x:number, y: number }, number]>((p, i) => [p, i])) {
    for (const p2 of points.slice(i + 1)) {
        if (p1.x == p2.x || p1.y == p2.y) {
            console.log(p1, p2);
        }
    }
}
