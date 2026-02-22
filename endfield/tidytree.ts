
// To make the production tree beautiful, you need...

// Tree Drawing Algorithms
// [1] C. Wetherell and A. Shannon, Tidy drawimgs of trees. IEEE Transactions on Software Engineering, vol. SE-5, pp. 514-520, 1979.
//     https://ieeexplore.ieee.org/document/1702661, the official site is not free, but this paper is too old so easy to download elsewhere
// [2] E.Reingold and J.Tilford. Tidier drawings of trees. IEEE Transactions on Software Engineering, 7(2):223–228, 1981.
//     https://ieeexplore.ieee.org/document/1702828, the official site is not free, but this paper is too old so easy to download elsewhere
// [3] J.Walker II. A node-positioning algorithm for general trees. Software–Practice and Experience, 20(7):685–705, 1990.
//     https://onlinelibrary.wiley.com/doi/10.1002/spe.4380200705, this site is not free, but this paper is too old so easy to download elsewhere
// [4] C. Buchheim, M. J¨unger, and S. Leipert. Improving Walker’s Algorithm to Run in Linear Time. In M. T. Goodrich and S. G.
//     Kobourov, editors, Graph Drawing, volume 2528 of Lecture Notes in Computer Science, pages 344–353. Springer Berlin Heidelberg, 2002.
//     https://link.springer.com/chapter/10.1007/3-540-36151-0_32, this site is free, that's modern free world

// Aesthetic rules
// // (aesthetic means pretty if you don't know the word)
// - nodes at the same depth level should lie along a straight line, the straight lines defining the levels should be parallel,
//   or without loss of generality, for top to bottom trees, nodes at the same depth level should have same horizontal position
// - nodes should be centered over its subtree
// - a tree and its mirror image should produce drawings that are reflections of one another, moveover, a subtree should be drawn 
//   the same way regardless of where it occurs in the tree, or in other words, ismorphic subtrees drawn isomorphically, or, context free

function randomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

interface BinaryNode {
    name: number,
    left?: BinaryNode,
    right?: BinaryNode,
    parent?: BinaryNode,
    // start from 0
    depth: number,
    // position is x coordinate, not [number, number] because y coordinate is already determined by depth
    position: number,
}

function generateBinaryTree(): BinaryNode {
    let nodeNameIndex = 1;
    function generate(parent: BinaryNode): BinaryNode {
        const current: BinaryNode = { name: nodeNameIndex++, parent, depth: (parent?.depth ?? -1) + 1, position: 0 };
        if (nodeNameIndex >= 20) {
            return current;
        }
        // P(hasleft) = 0.5 makes the tree too "not complete", allow more children
        // root should have children
        if (!parent || randomInt(1, 6) > 2) {
            current.left = generate(current);
        }
        if (!parent || randomInt(1, 6) > 2) {
            current.right = generate(current);
        }
        return current;
    }
    return generate(null);
}

function generateBinaryTree2(size: number = 0): BinaryNode {
    let nodeNameIndex = 1;
    function generate(size: number, parent: BinaryNode): BinaryNode {
        const node: BinaryNode = { name: nodeNameIndex++, parent, depth: (parent?.depth ?? -1) + 1, position: 0 };
        const leftSize = randomInt(0, size - 1);
        const rightSize = size - 1 - leftSize;
        if (leftSize) { node.left = generate(leftSize, node); }
        if (rightSize) { node.right = generate(rightSize, node); }
        return node;
    }
    // start from 10 nodes, too small tree is not useful
    return generate(size || randomInt(10, 30), null);
}

// item is [parent, left, right], left and right is 0 for null,
// to make depth easier, relationships should order from top to bottom
function createBinaryTree(relationships: [number, number, number][]): BinaryNode {
    const maxName = relationships.reduce((m, r) => Math.max(m, ...r), 0);
    const nodes = Array.from(new Array(maxName).fill(0).keys()).map<BinaryNode>(i => ({ name: i + 1, depth: 0, position: 0 }));
    for (const [nodeName, leftName, rightName] of relationships) {
        const node = nodes[nodeName - 1];
        if (leftName > 0) {
            node.left = nodes[leftName - 1];
            node.left.parent = node;
            node.left.depth = node.depth + 1;
        }
        if (rightName > 0) {
            node.right = nodes[rightName - 1];
            node.right.parent = node;
            node.right.depth = node.depth + 1;
        }
    }
    return nodes[0];
}
const allcase: BinaryNode[] = new Array(100).fill(null);

function notPrettyPrintBinaryTree(node: BinaryNode) {
    if (node.left || node.right) {
        console.log(`[${node.name}, ${node.left?.name ?? '0'}, ${node.right?.name ?? '0'}],`);
    }
    if (node.left) { notPrettyPrintBinaryTree(node.left); }
    if (node.right) { notPrettyPrintBinaryTree(node.right); }
}
function kindOfPrettyPrintBinaryTree(root: BinaryNode) {
    function visit(node: BinaryNode, f: (node: BinaryNode) => void) {
        f(node);
        if (node.left) { visit(node.left, f); }
        if (node.right) { visit(node.right, f); }
    }
    let maxDepth = 0;
    const allNodes: BinaryNode[] = [];
    visit(root, node => {
        allNodes.push(node);
        maxDepth = Math.max(maxDepth, node.depth);
    });
    for (const depth of new Array(maxDepth + 1).fill(0).keys()) {
        let sb = `depth ${depth}: `;
        for (const node of allNodes.filter(n => n.depth == depth)) {
            sb += `#${node.name} at ${node.position}, `;
        }
        sb = sb.substring(0, sb.length - 2);
        console.log(sb);
    }
}
function veryPrettyPrintBinaryTree(root: BinaryNode) {
    
    function visit(node: BinaryNode, f: (node: BinaryNode) => void) {
        f(node);
        if (node.left) { visit(node.left, f); }
        if (node.right) { visit(node.right, f); }
    }

    let maxDepth = 0;
    const allNodes: BinaryNode[] = [];
    visit(root, node => {
        allNodes.push(node);
        maxDepth = Math.max(maxDepth, node.depth);
    });

    for (const depth of new Array(maxDepth + 1).fill(0).keys()) {
        let sb = '';
        const thisDepthNodes = allNodes.filter(n => n.depth == depth);
        const maxPosition = thisDepthNodes.reduce((m, n) => Math.max(m, n.position), 0);
        for (const position of new Array(maxPosition + 1).fill(0).keys()) {
            if (thisDepthNodes.filter(n => n.position == position).length > 1) {
                console.log(`!!! depth ${depth} position ${position} have overlapped nodes`);
            }
            const node = thisDepthNodes.find(n => n.position == position);
            if (node) {
                sb += `#${node.name}`.padStart(5);
            } else {
                sb += ''.padStart(5);
            }
        }
        console.log(sb);
    }
    console.log(); // margin bottom 1 line
}
function maybeClearerPrettyPrintBinaryTree(root: BinaryNode) {
    
    function visit(node: BinaryNode, f: (node: BinaryNode) => void) {
        f(node);
        if (node.left) { visit(node.left, f); }
        if (node.right) { visit(node.right, f); }
    }

    let maxDepth = 0;
    const allNodes: BinaryNode[] = [];
    visit(root, node => {
        allNodes.push(node);
        maxDepth = Math.max(maxDepth, node.depth);
    });

    for (const depth of new Array(maxDepth + 1).fill(0).keys()) {
        let sb = '';
        const thisDepthNodes = allNodes.filter(n => n.depth == depth);
        const maxPosition = thisDepthNodes.reduce((m, n) => Math.max(m, n.position), 0);
        for (const position of new Array(maxPosition + 1).fill(0).keys()) {
            const node = thisDepthNodes.find(n => n.position == position);
            if (node) {
                if (node.left || node.right) {
                    sb += `${node.left?.name?.toString()?.padStart(2) ?? '__'}:${node.name.toString().padStart(2)}:${node.right?.name?.toString()?.padStart(2) ?? '__'}`.padStart(10);
                } else {
                    sb += `:${node.name.toString().padStart(2)}:`.padStart(8).padEnd(10);
                }
            } else {
                sb += ''.padEnd(10);
            }
        }
        console.log(sb);
    }
    console.log(); // margin bottom 1 line
}

// record node name => node position for automatic comparison between implementations
function collectLayoutResult(root: BinaryNode): Map<number, number> {
    const result = new Map<number, number>();
    function visit(node: BinaryNode, f: (node: BinaryNode) => void) {
        f(node);
        if (node.left) { visit(node.left, f); }
        if (node.right) { visit(node.right, f); }
    }
    visit(root, node => {
        result.set(node.name, node.position);
    });
    return result;
}

// -----------------------------------------
// -------------- PAPER 1 ------------------
// -----------------------------------------

interface BinaryNode1 extends BinaryNode {
    left?: BinaryNode1,
    right?: BinaryNode1,
    parent?: BinaryNode1,
    modifier: number,
}

// paper 1 algorithm 3 original version
// restrict node spacing in each line by nextposition, next available position in each line
// if a node is pushed right because of nextposition restriction, add to its modifier field to move all its decendents to the right
function layout1_1(root: BinaryNode1, log: boolean = false) {

    function visit(node: BinaryNode1, f: (node: BinaryNode1) => void) {
        if (node.left) { visit(node.left, f); }
        if (node.right) { visit(node.right, f); }
        f(node);
    }
    
    let maxDepth = 0;
    visit(root, node => {
        maxDepth = Math.max(maxDepth, node.depth);
    });

    const modifiers = new Array(maxDepth + 1).fill(0);
    // they start from 1, but start from 0 is also ok
    const nextPosition = new Array(maxDepth + 1).fill(0);
    visit(root, node => {
        if (!node.left && !node.right) {
            // for a leaf node, put it at next available place
            node.position = nextPosition[node.depth];
            // and inherit modifier from left
            node.modifier = modifiers[node.depth];
        } else {
            // for a non leaf node, first find a desendants wanted position
            const position = node.left && node.right ? Math.floor((node.left.position
                + node.right.position) / 2) : node.left ? node.left.position + 1 : node.right.position - 1;

            node.modifier = modifiers[node.depth] = Math.max(modifiers[node.depth], nextPosition[node.depth] - position);
            node.position = position + node.modifier;
        }
        nextPosition[node.depth] = node.position + 2;
        if (log) { console.log(`node#${node.name}, x = ${node.position}, modifier = ${node.modifier}`); }
    });

    visit(root, node => {
        // ATTENTION node.modifier is for all its descendents, NOT itself
        let current = node.parent;
        while (current) {
            node.position += current.modifier;
            current = current.parent;
        }
    });
}

// paper 1 algorithm 3 tweak core logic to make it clear
function layout1_2(root: BinaryNode1, log: boolean = false) {

    function visit(node: BinaryNode1, f: (node: BinaryNode1) => void) {
        if (node.left) { visit(node.left, f); }
        if (node.right) { visit(node.right, f); }
        f(node);
    }
    
    let maxDepth = 0;
    visit(root, node => {
        maxDepth = Math.max(maxDepth, node.depth);
    });

    const modifiers = new Array(maxDepth + 1).fill(0);
    // they start from 1, but start from 0 is also ok
    const nextPosition = new Array(maxDepth + 1).fill(0);
    visit(root, node => {
        if (!node.left && !node.right) {
            // for a leaf node, put it at next available place
            node.position = nextPosition[node.depth];
            // and inherit modifier from left
            node.modifier = modifiers[node.depth];
        } else {
            // for a non leaf node, desendants wanted position
            const position = node.left && node.right ? Math.floor((node.left.position
                + node.right.position) / 2) : node.left ? node.left.position + 1 : node.right.position - 1;

            // original implementation for reference
            // node.modifier = modifiers[node.depth] = Math.max(modifiers[node.depth], nextpos[node.depth] - position);
            // node.position = position + node.modifier;

            // if nothing special happens, that position is result position, modifier is inherit
            node.position = position;
            node.modifier = modifiers[node.depth];
            // if descendants wanted position does not satisfy nextpos, move this node and desendants right
            if (nextPosition[node.depth] > position) {
                node.position = nextPosition[node.depth];
                // when nextposition is satisified
                node.modifier = nextPosition[node.depth] - position;
            }
            // if this line already have modifier, and the movement requirement is larger than than from nextpos, use this
            if (modifiers[node.depth] > nextPosition[node.depth] - position) {
                node.position = position + modifiers[node.depth];
                node.modifier = modifiers[node.depth];
            }
        }
        nextPosition[node.depth] = node.position + 2;
        if (log) { console.log(`node#${node.name}, x = ${node.position}, modifier = ${node.modifier}`); }
    });

    visit(root, node => {
        // ATTENTION node.modifier is for all its descendents, NOT itself
        let current = node.parent;
        while (current) {
            node.position += current.modifier;
            current = current.parent;
        }
    });
}

// paper 1 algorithm 3, 1_2 fixed version
// 1_2 has difference with 1_1 in some cases, and 1_3 is exactly same as 1_1 according to manual inspection
function layout1_3(root: BinaryNode1, log: boolean = false, basePosition: number = 0) {

    function visit(node: BinaryNode1, f: (node: BinaryNode1) => void) {
        if (node.left) { visit(node.left, f); }
        if (node.right) { visit(node.right, f); }
        f(node);
    }
    
    let maxDepth = 0;
    visit(root, node => {
        maxDepth = Math.max(maxDepth, node.depth);
    });

    const modifiers = new Array(maxDepth + 1).fill(0);
    // they start from 1, but start from 0 is also ok
    // UPDATE: add baseposition parameter to make it easier align with layout2 when investigating
    const nextPosition = new Array(maxDepth + 1).fill(basePosition);
    visit(root, node => {
        if (!node.left && !node.right) {
            // for a leaf node, put it at next available place
            node.position = nextPosition[node.depth];
            // and inherit modifier from left
            node.modifier = modifiers[node.depth];
        } else {
            // for a non leaf node, desendants wanted position
            const descendantsWanted = node.left && node.right ? Math.floor((node.left.position
                + node.right.position) / 2) : node.left ? node.left.position + 1 : node.right.position - 1;
            // nextposition and modifiers both want to push this subtree right
            const nextPositionWanted = nextPosition[node.depth];
            const modifiersWanted = descendantsWanted + modifiers[node.depth];

            // original implementation for reference
            // node.modifier = modifiers[node.depth] = Math.max(modifiers[node.depth], nextPosition[node.depth] - descendantsWanted);
            // node.position = descendantsWanted + node.modifier;

            // choose a larger one between this 3 positions
            node.position = Math.max(descendantsWanted, nextPositionWanted, modifiersWanted);
            // don't forget to update modifiers after assign to this modifier
            node.modifier = modifiers[node.depth] = node.position - descendantsWanted;
        }
        nextPosition[node.depth] = node.position + 2;
        if (log) { console.log(`node#${node.name}, x = ${node.position}, modifier = ${node.modifier}`); }
    });

    visit(root, node => {
        // ATTENTION node.modifier is for all its descendents, NOT itself
        let current = node.parent;
        while (current) {
            node.position += current.modifier;
            current = current.parent;
        }
    });
}

// NOTE paper 1 have a modification to the main algorithm, this modification seems not inherited in following papers, so skip for now
// function layout1_4() {
//     ...
// }

// // random case
// const tree = generateBinaryTree() as BinaryNode1;
// notPrettyPrintBinaryTree(tree);

// case 1: paper 1 fig 5
allcase[1] = createBinaryTree([
    [1, 2, 3],
    [2, 4, 5],
    [3, 0, 6],
    [5, 7, 8],
    [6, 0, 9],
    [9, 10, 0],
    [10, 11, 12],
    [11, 13, 14],
]) as BinaryNode1;

// // case 2: paper 1 fig 8
allcase[2] = createBinaryTree([
    [1, 2, 3],
    [2, 4, 5],
    [3, 6, 7],
    [7, 8, 9],
    [8, 0, 10],
    [10, 0, 11],
    [11, 0, 12],
    [12, 0, 13],
]) as BinaryNode1;

// case 3: paper 2 fig 1, this have unwanted shift right at node#15
// this also shows layout1_2 have defact, it is fixed in layout1_3
allcase[3] = createBinaryTree([
    [1, 2, 3],
    [2, 4, 5],
    [3, 6, 7],
    [4, 8, 9],
    [7, 10, 11],
    [8, 12, 13],
    [11, 14, 15],
    [12, 16, 17],
    [15, 18, 19],
    [17, 20, 21],
    [18, 22, 23],
    [21, 24, 25],
    [22, 26, 27],
    [25, 28, 29],
    [26, 30, 31],
]) as BinaryNode1;

// case 4: a random case also shows layout1_2 have defact
allcase[4] = createBinaryTree([
    [1, 2, 4],
    [2, 0, 3],
    [4, 5, 26],
    [5, 6, 25],
    [6, 7, 24],
    [7, 8, 0],
    [8, 9, 0],
    [9, 10, 23],
    [10, 11, 0],
    [11, 0, 12],
    [12, 13, 0],
    [13, 14, 22],
    [14, 15, 21],
    [15, 16, 0],
    [16, 17, 0],
    [17, 18, 20],
    [18, 0 , 19],
]) as BinaryNode1;

// case 5: paper 2 fig 5 shows paper 1 produce different subtree even though they are same structure
// this example seems refer to modified version of paper 1 (layout1_4), which is not implmenented here, but original version also have this issue
allcase[5] = createBinaryTree([
    [1, 2, 3],
    [3, 4, 5],
    [4, 6, 0],
    [6, 0, 9],
    [5, 7, 8],
    [8, 10, 11],
    [10, 12, 0],
    [11, 13, 14],
    [12, 0, 15],
    [13, 0, 16],
    [14, 17, 0],
]) as BinaryNode1;

// layout1_1(tree);
// veryPrettyPrintBinaryTree(tree);
// layout1_2(tree);
// veryPrettyPrintBinaryTree(tree);
// layout1_3(tree);
// veryPrettyPrintBinaryTree(tree);

// -----------------------------------------
// -------------- PAPER 2 ------------------
// -----------------------------------------

// put original source code here, it's difficult to copy it from scanned pdf ocr result, language is pascal
/*
PROGRAM DRAW;
TYPE
    NODE = RECORD
        INFO: INTEGER;
        LLINK,
        RLINK: ^NODE; (* POINTERS TO SUBTREES *)
        XCOORD,
        YCOORD: INTEGER; (* COORDINATES OF THIS NODE *)
        OFFSET: INTEGER; (* DISTANCE TO EACH SON *)
        THREAD: BOOLEAN
    END;
    EXTREME = RECORD
        ADDR: ^NODE;
        OFF: INTEGER;
        LEV: INTEGER
    END;
    LINK = ^NODE;

PROCEDURE SETUP (
    T: LINK;                     (* ROOT OF SUBTREE *)
    LEVEL: INTEGER;              (* CURRENT OVERALL LEVEL *)
    VAR RMOST, LMOST: EXTREME ); (* EXTREME DESCENDANTS *)
(* THIS PROCEDURE IMPLEMENTS ALGORITHM TR, ASSIGNING RELATIVE *)
(* POSITIONINGS TO ALL NODES IN THE TREE POINTED TO BY PARAMETER T. *)
VAR
    L, R: LINK;                (* LEFT AND RIGHT SONS *)
    LR, LL, RR, RL : EXTREME;  (* LR - RIGHTMOST NODE ON *)
                               (* LOWEST LEVEL OF LEFT SUBTREE *)
                               (* AND SO ON *)
    CURSEP,                    (* SEPARATION ON CURRENT LEVEL *)
    ROOTSEP,                   (* CURRENT SEPARATION AT NODE T *)
    LOFFSUM, ROFFSUM: INTEGER; (* OFFSET FROM L & R TO T *)

BEGIN (* SETUP *)
    IF T = NIL THEN BEGIN      (* AVOID SELECTING AS EXTREME *)
        LMOST.LEV := -1;
        RMOST.LEV := -1
    END ELSE BEGIN
        T^.YCOORD := LEVEL;    
        L := T^.LLINK;         (* FOLLOWS CONTOUR OF LEFT SUBTREE *)
        R := T^.RLINK;         (* FOLLOWS CONTOUR OF RIGHT SUBTREE *)
        SETUP(L, LEVEL + 1, LR, LL); (* POSITION SUBTREES RECURSIVELY *)
        SETUP(R, LEVEL + 1, RR, RL);
        IF (R=NIL) AND (L=NIL) THEN BEGIN (* LEAF *)
            RMOST.ADDR := T;     (* A LEAF IS BOTH THE LEFTMOST *)
            LMOST.ADDR := T;     (* AND RIGHTMOST NODE ON THE *)
            RMOST.LEV := LEVEL;  (* LOWEST LEVEL OF THE SUBTREE *)
            LMOST.LEV := LEVEL;  (* CONSISTING OF ITSELF *)
            RMOST.OFF := 0;
            LMOST.OFF := 0;
            T^.OFFSET := 0
        END ELSE BEGIN (* T NOT A LEAF *)

            (* SET UP FOR SUBTREE PUSHING. PLACE ROOTS OF *)
            (* SUBTREES MINIMUM DISTANCE APART. *)
            CURSEP := MINSEP;
            ROOTSEP := MINSEP;
            LOFFSUM := 0;
            ROFFSUM := 0;

            (* NOW CONSIDER EACH LEVEL IN TURN UNTIL ONE *)
            (* SUBTREE IS EXHAUSTED, PUSHING THE SUOTREES *)
            (* APART WHEN NECESSARY. *)
            WHILE (L<>NIL) AND (R<>NIL) DO BEGIN
                IF CURSEP < MINSEP THEN BEGIN (* PUSH ? *)
                    ROOTSEP := ROOTSEP + (MINSEP - CURSEP);
                    CURSEP := MINSEP
                END; (* IF CURSEP < MINSEP *)

                (* ADVANCE L & R *)
                IF L^.RLINK <> NIL THEN BEGIN
                    LOFFSUM := LOFFSUM + L^.OFFSET;
                    CURSEP := CURSEP - L^.OFFSET;
                    L := L^.RLINK
                END ELSE BEGIN
                    LOFFSUM := LOFFSUM - L^.OFFSET;
                    CURSEP := CURSEP + L^.OFFSET;
                    L := L^.LLINK
                END;
                IF R^.LLINK <> NIL THEN BEGIN
                    ROFFSUM := ROFFSUM - R^.OFFSET;
                    CURSEP := CURSEP - R^.OFFSET;
                    R := R^.LLINK
                END ELSE BEGIN
                    ROFFSUM := ROFFSUM + R^.OFFSET;
                    CURSEP := CURSEP + R^.OFFSET;
                    R := R^.RLINK
                END; (* ELSE *)
            END; (* WHILE *)

            (* SET THE OFFSET IN NODE T, AND INCLUDE IT IN *)
            (* ACCUMULATED OFFSETS FOR L AND R *)

            T^.OFFSET := (ROOTSEP + 1) DIV 2;
            LOFFSUM := LOFFSUM - T^.OFFSET;
            ROFFSUM := ROFFSUM + T^.OFFSET;

            (* UPDATE EXTREME DESCENDANTS INFORMATION *)
    
            IF (RL.LEV > LL.LEV) OR (T^.LLINK = NIL) THEN BEGIN
                LMOST := RL;
                LMOST.OFF := LMOST.OFF + T^.OFFSET
            END ELSE BEGIN
                LMOST := LL;
                LMOST.OFF := LMOST.OFF - T^.OFFSET
            END;
            IF (LR.LEV > RR.LEV) OR (T^.RLINK = NIL) THEN BEGIN
                RMOST := LR;
                RMOST.OFF := RMOST.OFF - T^.OFFSET
            END ELSE BEGIN
                RMOST := RR;
                RMOST.OFF := RMOST.OFF + T^.OFFSET
            END;

            (* IF SUBTREES OF T WERE OF UNEVEN HEIGHTS, CHECK *)
            (* TO SEE IF THREADING IS NECESSARY. AT MOST ONE *)
            (* THREAD NEEDS TO BE INSERTED. *)
    
            IF (L <> NIL) AND (L <> T^.LLINK) THEN BEGIN
                RR.ADDR^.THREAD := TRUE;
                RR.ADDR^.OFFSET := ABS((RR.OFF + T^.OFFSET) - LOFFSUM);
                IF LOFFSUM - T^.OFFSET <= RR.OFF THEN
                    RR.ADDR^.LLINK := L
                ELSE
                    RR.ADDR^.RLINK := L
            END ELSE IF (R <> NIL) AND (R <> T^.RLINK) THEN BEGIN
                LL.ADDR^.THREAD := TRUE;
                LL.ADDR^.OFFSET := ABS((LL.OFF - T^.OFFSET) - ROFFSUM);
                IF ROFFSUM + T^.OFFSET >= LL.OFF THEN
                    LL.ADDR^.RLINK := R
                ELSE
                    LL.ADDR^.LLINK := R
            END
        END; (* OF IF NOT LEAF *)
    END; (* OF T <> NIL *)
END; (* PROCEDURE SETUP *)

PROCEDURE PETRIFY (T: LINK; XPOS: COLUMN);
(* THIS PROCEDURE PERFORMS A PREORDER TRAVERSAL OF THE TREE, *)
(* CONVERTING THE RELATIVE OFFSETS TO ABSOLUTE COORDINATES. *)
BEGIN
    IF T <> NIL THEN BEGIN
        T^.XCOORD := XPOS;
        IF T^.THREAD THEN BEGIN
            T^.THREAD := FALSE;
            T^.RLINK := NIL;
            T^.LLINK := NIL; (* THREADED NODE MUST BE A LEAF *)
        END;
        PETRIFY(T^.LLINK, XPOS - T^.OFFSET);
        PETRIFY(T^.RLINK, XPOS + T^.OFFSET)
    END (* IF T <> NIL *)
END; (* PETRIFY *)
*/

interface BinaryNode2 extends BinaryNode {
    left?: BinaryNode2,
    right?: BinaryNode2,
    parent?: BinaryNode2,
    // distance between this node and left child if have left child,
    // distance between this node and right child if have right child,
    // they use same distance
    offset?: number,
    thread?: boolean,
}

interface OutmostNode {
    node: BinaryNode2,
    offset: number, // relative offset from current node, this value may be negative
    depth: number,
}

const MinSeparation = 1;

// the source code in paper is too long to understand,
// first translate them into javascript and rename the types and variables
// T: node
// L, R: leftnode, rightnode
// LL, LR, RL, RR: leftSubtreeLeftmost, leftSubtreeRightmost, rightSubtreeLeftmost, rightSubtreeRightmost
// LMOST, RMOST: leftmost, rightmost
// CURSEP: currentSeparation
// ROOTSEP: thisSeparation
// LOFFSUM, ROFFSUM: leftOffset, rightOffset
// LLINK, RLINK: left, right
function layout2_1(root: BinaryNode2) {

    function setup(node: BinaryNode2, leftmost: OutmostNode, rightmost: OutmostNode) {
        // a leaf node is both the leftmost and rightmost node of the subtree
        if (!node.left && !node.right) {
            leftmost.node = node;
            leftmost.depth = node.depth;
            leftmost.offset = 0;
            rightmost.node = node;
            rightmost.depth = node.depth;
            rightmost.offset = 0;
            node.offset = 0;
            return;
        }

        const leftSubtreeBottomLeftmost: OutmostNode = { node: null, offset: 0, depth: -1 };
        const leftSubtreeBottomRightmost: OutmostNode = { node: null, offset: 0, depth: -1 };
        const rightSubtreeBottomLeftmost: OutmostNode = { node: null, offset: 0, depth: -1 };
        const rightSubtreeBottomRightmost: OutmostNode = { node: null, offset: 0, depth: -1 };
        if (node.left) {
            setup(node.left, leftSubtreeBottomLeftmost, leftSubtreeBottomRightmost);
        }
        if (node.right) {
            setup(node.right, rightSubtreeBottomLeftmost, rightSubtreeBottomRightmost);
        }

        let thisSeparation = MinSeparation; // separation of parameter node
        let currentSeparation = MinSeparation; // separation in following iteration
        let leftTotalOffset = 0; // offset from leftmost to node
        let rightTotalOffset = 0; // offset from rightmost to node

        // Now consider each level in turn until one subtree is exhausted, pushing the subtrees apart when necessary.
        let left = node.left;
        let right = node.right;
        while (left && right) {
            if (currentSeparation < MinSeparation) {
                thisSeparation += MinSeparation - currentSeparation;
                currentSeparation = MinSeparation;
            }
            if (left.right) {
                leftTotalOffset += left.offset;
                currentSeparation -= left.offset;
                left = left.right;
            } else {
                leftTotalOffset -= left.offset;
                currentSeparation += left.offset;
                left = left.left;
            }
            if (right.left) {
                rightTotalOffset -= right.offset;
                currentSeparation -= right.offset;
                right = right.left;
            } else {
                rightTotalOffset += right.offset;
                currentSeparation += right.offset;
                right = right.right;
            }
        }

        // Set the offset in node, and include it in accumulated offsets for left and right
        node.offset = Math.floor((thisSeparation + 1) / 2);
        leftTotalOffset -= node.offset;
        rightTotalOffset += node.offset;

        // Update outmost descendants information
        if (!node.left || rightSubtreeBottomLeftmost.depth > leftSubtreeBottomLeftmost.depth) {
            leftmost.node = rightSubtreeBottomLeftmost.node;
            leftmost.depth = rightSubtreeBottomLeftmost.depth;
            leftmost.offset = rightSubtreeBottomLeftmost.offset + node.offset;
        } else {
            leftmost.node = leftSubtreeBottomLeftmost.node;
            leftmost.depth = leftSubtreeBottomLeftmost.depth;
            leftmost.offset = leftSubtreeBottomLeftmost.offset + node.offset;
        }
        if (!node.right || leftSubtreeBottomRightmost.depth > rightSubtreeBottomRightmost.depth) {
            rightmost.node = leftSubtreeBottomRightmost.node;
            rightmost.depth = leftSubtreeBottomRightmost.depth;
            rightmost.offset = leftSubtreeBottomRightmost.offset - node.offset;
        } else {
            rightmost.node = rightSubtreeBottomRightmost.node;
            rightmost.depth = rightSubtreeBottomRightmost.depth;
            rightmost.offset = rightSubtreeBottomRightmost.offset + node.offset;
        }

        // If subtrees of node were of uneven heights, check to see if threading is necessary. At most one thread needs to be inserted.
        if (left && left.name != node.left.name) {
            rightSubtreeBottomRightmost.node.thread = true;
            rightSubtreeBottomRightmost.node.offset = Math.abs(rightSubtreeBottomRightmost.offset + node.offset - leftTotalOffset);
            if (leftTotalOffset - node.offset <= rightSubtreeBottomRightmost.offset) {
                rightSubtreeBottomRightmost.node.left = left;
            } else {
                rightSubtreeBottomRightmost.node.right = left;
            }
        } else if (right && right.name != node.right.name) {
            leftSubtreeBottomLeftmost.node.thread = true;
            leftSubtreeBottomLeftmost.node.offset = Math.abs(leftSubtreeBottomLeftmost.offset - node.offset - rightTotalOffset);
            if (rightTotalOffset + node.offset >= leftSubtreeBottomLeftmost.offset) {
                leftSubtreeBottomLeftmost.node.right = right;
            } else {
                leftSubtreeBottomLeftmost.node.left = right;
            }
        }
    }

    function petrify(node: BinaryNode2, position: number) {
        node.position = position;
        if (node.thread) {
            node.thread = false;
            node.left = null;
            node.right = null;
        }
        if (node.left) {
            petrify(node.left, position - node.offset);
        }
        if (node.right) {
            petrify(node.right, position + node.offset);
        }
    }
    
    const [rootLeftmost, rootRightmost] = [{ node: null, offset: 0, depth: -1 }, { node: null, offset: 0, depth: -1 }];
    setup(root, rootLeftmost, rootRightmost);
    // console.log(rootLeftmost, rootRightmost);
    // temporary position them by arbitrary base position, and fix later by checkPosition and normalizePosition
    petrify(root, 10);
    
    let minPosition = 100;
    function checkPosition(node: BinaryNode2) {
        minPosition = Math.min(minPosition, node.position);
        if (node.left) {
            checkPosition(node.left);
        }
        if (node.right) {
            checkPosition(node.right);
        }
    }
    checkPosition(root);
    // make minposition=0
    function normalizePosition(node: BinaryNode2) {
        node.position -= minPosition;
        if (node.left) {
            normalizePosition(node.left);
        }
        if (node.right) {
            normalizePosition(node.right);
        }
    }
    normalizePosition(root);
}

// OutmostNode.depth seems always .node.depth, but to make sure it's ok to remove, do not change 2_1, so add a new type here
// RESULT of remove depth: ok
interface OutmostNode2 {
    node: BinaryNode2,
    offset: number, // relative offset from current node, this value may be negative
}

function layout2_2(root: BinaryNode2, log: boolean = false) {

    function setup(node: BinaryNode2, leftmost: OutmostNode2, rightmost: OutmostNode2) {

        // a leaf node is both the leftmost and rightmost node of the subtree
        if (!node.left && !node.right) {
            node.offset = 0;
            leftmost.node = node;
            leftmost.offset = 0;
            rightmost.node = node;
            rightmost.offset = 0;
            return;
        }

        // leftmost node on *lowest* level of left subtree, etc.
        const leftSubtreeBottomLevelLeftmost: OutmostNode2 = { node: null, offset: 0 };
        const leftSubtreeBottomLevelRightmost: OutmostNode2 = { node: null, offset: 0 };
        const rightSubtreeBottomLevelLeftmost: OutmostNode2 = { node: null, offset: 0 };
        const rightSubtreeBottomLevelRightmost: OutmostNode2 = { node: null, offset: 0 };
        if (node.left) {
            setup(node.left, leftSubtreeBottomLevelLeftmost, leftSubtreeBottomLevelRightmost);
            // early return if no right
            if (!node.right) {
                node.offset = Math.floor((MinSeparation + 1) / 2);
                leftmost.node = leftSubtreeBottomLevelLeftmost.node;
                leftmost.offset = leftSubtreeBottomLevelLeftmost.offset + node.offset;
                rightmost.node = leftSubtreeBottomLevelRightmost.node;
                rightmost.offset = leftSubtreeBottomLevelRightmost.offset - node.offset;
                return;
            }
        }
        if (node.right) {
            setup(node.right, rightSubtreeBottomLevelLeftmost, rightSubtreeBottomLevelRightmost);
            // early return if no left
            if (!node.left) {
                node.offset = Math.floor((MinSeparation + 1) / 2);
                leftmost.node = rightSubtreeBottomLevelLeftmost.node;
                leftmost.offset = rightSubtreeBottomLevelLeftmost.offset + node.offset;
                rightmost.node = rightSubtreeBottomLevelRightmost.node;
                rightmost.offset = rightSubtreeBottomLevelRightmost.offset + node.offset;
                return;
            }
        }

        // required separation of this node's left child and right child
        let thisSeparation = MinSeparation;
        // when comparing in each iteration, is the separation of
        // left subtree rightmost node and right subtree leftmost node *at this depth*,
        // NOTE not the leftSubtreeRightmost variable, that's at bottom level
        let currentSeparation = MinSeparation;
        // at the beginning of each iteration,
        // is the offset from this node.left to left subtree rightmost node *at this depth*,
        // NOTE not this node.left to leftSubtreeRightmost variable, that's at bottom level
        // this is offset, not distance, this is positive when right boundary is at right of thisnode.left, negative when is at left of thisnode.left
        let leftSubtreeRightmostOffset = 0;
        let rightSubtreeLeftmostOffset = 0;

        // Now consider each level in turn until one subtree is exhausted, pushing the subtrees apart when necessary.
        let left = node.left;
        let right = node.right;
        while (left && right) {
            if (currentSeparation != rightSubtreeLeftmostOffset - leftSubtreeRightmostOffset + thisSeparation) {
                console.log('!!!(1)unexpected relationship', currentSeparation, rightSubtreeLeftmostOffset - leftSubtreeRightmostOffset + thisSeparation);
            }
            if (log) { console.log(`#${node.name} try push apart #${left.name} and #${right.name}`); }
            if (currentSeparation < MinSeparation) {
                if (log) { console.log(`#${node.name} push apart current separation ${currentSeparation}`); }
                thisSeparation += MinSeparation - currentSeparation;
                currentSeparation = MinSeparation;
            }
            if (currentSeparation != rightSubtreeLeftmostOffset - leftSubtreeRightmostOffset + thisSeparation) {
                console.log('!!!(2)unexpected relationship', currentSeparation, rightSubtreeLeftmostOffset - leftSubtreeRightmostOffset + thisSeparation);
            }
            if (left.right) {
                leftSubtreeRightmostOffset += left.offset;
                // left move from left to left.right, current separation decreases left.offset
                currentSeparation -= left.offset;
                if (log && left.thread && left.right) { console.log(`#${node.name} going down from threaded #${left.name} to #${left.right?.name ?? '(not going down)'}`); }
                left = left.right;
            } else {
                leftSubtreeRightmostOffset -= left.offset;
                currentSeparation += left.offset;
                if (log && left.thread && left.left) { console.log(`#${node.name} going down from threaded #${left.name} to #${left.left?.name ?? '(not going down)'}`); }
                left = left.left;
            }
            if (right.left) {
                rightSubtreeLeftmostOffset -= right.offset;
                currentSeparation -= right.offset;
                if (log && right.thread && right.left) { console.log(`#${node.name} going down from threaded #${right.name} to #${right.left?.name ?? '(not going down)'}`); }
                right = right.left;
            } else {
                rightSubtreeLeftmostOffset += right.offset;
                currentSeparation += right.offset;
                if (log && right.thread && right.right) { console.log(`#${node.name} going down from threaded #${right.name} to #${right.right?.name ?? '(not going down)'}`); }
                right = right.right;
            }
        }
        // the final left and right, if not null, left should be the at the right boundary of left subtree, right should be at the left boundary of right subtree
        // the thread mechanism will correctly link the branch until bottom of the subtree, so the result left and right, if not null, must be at bottom of left subtree and right subtree

        // this is the only assignment to node.offset
        node.offset = Math.floor((thisSeparation + 1) / 2);

        // lefttotaloffset is offset from node.left to left subtree rightmost node at final level (or bottom level because of the thread mechanism) after the loop
        // then subtract thisnode.offset here, becomes the offset from thisnode to left subtree right node at bottom level
        leftSubtreeRightmostOffset -= node.offset;
        rightSubtreeLeftmostOffset += node.offset;
        if (log) { console.log(`#${node.name} offset ${node.offset} left offset ${leftSubtreeRightmostOffset} right offset ${rightSubtreeLeftmostOffset}`); }

        // for a leaf node, leftmost and rightmost is at the deepest level of the subtree (only contains the node itself)
        // for any non leaf node, if left subtree leftmost and rightmost is at the deepest level of left subtree, and right subtree leftmost and rightmost is at the deepest level of right subtree
        //    then this node's leftmost is the deeper in left subtree leftmost and right subtree rightmost, which must be at the deepest level of the subtree from this node
        // so for any node, leftmost and rightmost must be at the deepest level of the subtree rooted at this node
        if (!node.left || (rightSubtreeBottomLevelLeftmost.node && leftSubtreeBottomLevelLeftmost.node && rightSubtreeBottomLevelLeftmost.node.depth > leftSubtreeBottomLevelLeftmost.node.depth)) {
            // bottom most of thisnode is the deeper in left subtree bottom and right subtree bottom
            leftmost.node = rightSubtreeBottomLevelLeftmost.node;
            // the result thisnode bottom most offset is offset from thisnode.right to right subtree bottom most add thisnode's offset
            leftmost.offset = rightSubtreeBottomLevelLeftmost.offset + node.offset;
            if (log) { console.log(`#${node.name} left outmost is right subtree bottom leftmost #${leftmost.node.name} offset ${leftmost.offset}`); }
        } else {
            leftmost.node = leftSubtreeBottomLevelLeftmost.node;
            leftmost.offset = leftSubtreeBottomLevelLeftmost.offset + node.offset;
            if (log) { console.log(`#${node.name} left outmost is left subtree bottom leftmost #${leftmost.node.name} offset ${leftmost.offset}`); }
        }
        if (!node.right || (leftSubtreeBottomLevelRightmost.node && rightSubtreeBottomLevelRightmost.node && leftSubtreeBottomLevelRightmost.node.depth > rightSubtreeBottomLevelRightmost.node.depth)) {
            rightmost.node = leftSubtreeBottomLevelRightmost.node;
            rightmost.offset = leftSubtreeBottomLevelRightmost.offset - node.offset;
            if (log) { console.log(`#${node.name} right outmost is left subtree bottom rightmost #${rightmost.node?.name} offset ${rightmost.offset}`); }
        } else {
            rightmost.node = rightSubtreeBottomLevelRightmost.node;
            rightmost.offset = rightSubtreeBottomLevelRightmost.offset + node.offset;
            if (log) { console.log(`#${node.name} right outmost is right subtree bottom rightmost #${rightmost.node?.name} offset ${rightmost.offset}`); }
        }

        // when left == node.left, that means node.left != null and node.right == null, in this case, no right subtree bottom most is set, cannot add thread
        if (left && left.name != node.left.name) {
            // if left, then right is null, left subtree is deeper than right subtree,
            // then add a thread to the right subtree bottom level right most node to left side final node, which is left subtree rightmost node at the level that is one level below right subtree bottom level
            // this thread correctly maintains right boundary of subtree of thisnode
            // no need to continue linking is because the subtree inside left subtree below bottom of right subtree bottom already maintains its right boundary
            rightSubtreeBottomLevelRightmost.node.thread = true;
            if (log) { console.log(`#${node.name} alternating right subtree right most #${rightSubtreeBottomLevelRightmost.node
                .name} offset from ${rightSubtreeBottomLevelRightmost.node.offset} to ${Math.abs(rightSubtreeBottomLevelRightmost.offset + node.offset - leftSubtreeRightmostOffset)}`); }
            // TODO what's this + then -
            rightSubtreeBottomLevelRightmost.node.offset = Math.abs(rightSubtreeBottomLevelRightmost.offset + node.offset - leftSubtreeRightmostOffset);
            if (leftSubtreeRightmostOffset - node.offset <= rightSubtreeBottomLevelRightmost.offset) {
                rightSubtreeBottomLevelRightmost.node.left = left;
                if (log) { console.log(`#${node.name} threading right subtree right most #${rightSubtreeBottomLevelRightmost.node.name}.left to #${left.name}`); }
            } else {
                rightSubtreeBottomLevelRightmost.node.right = left;
                if (log) { console.log(`#${node.name} threading right subtree right most #${rightSubtreeBottomLevelRightmost.node.name}.right to #${left.name}`); }
            }
        } else if (right && right.name != node.right.name) {
            leftSubtreeBottomLevelLeftmost.node.thread = true;
            if (log) { console.log(`#${node.name} alternating left subtree left most #${leftSubtreeBottomLevelLeftmost.node
                .name} offset from ${leftSubtreeBottomLevelLeftmost.node.offset} to ${Math.abs(leftSubtreeBottomLevelLeftmost.offset - node.offset - leftSubtreeRightmostOffset)}`); }
            leftSubtreeBottomLevelLeftmost.node.offset = Math.abs(leftSubtreeBottomLevelLeftmost.offset - node.offset - rightSubtreeLeftmostOffset);
            if (rightSubtreeLeftmostOffset + node.offset >= leftSubtreeBottomLevelLeftmost.offset) {
                leftSubtreeBottomLevelLeftmost.node.right = right;
                if (log) { console.log(`#${node.name} threading left subtree left most #${leftSubtreeBottomLevelLeftmost.node.name}.right to #${right.name}`); }
            } else {
                leftSubtreeBottomLevelLeftmost.node.left = right;
                if (log) { console.log(`#${node.name} threading left subtree left most #${leftSubtreeBottomLevelLeftmost.node.name}.left to #${right.name}`); }
            }
        }
    }
    
    const [rootLeftmost, rootRightmost] = [{ node: null, offset: 0 }, { node: null, offset: 0 }];
    setup(root, rootLeftmost, rootRightmost);
    // TODO check again after understand how the outmost parameters work
    let minPosition = 100;
    function setPosition1(node: BinaryNode2, position: number) {
        node.position = position;
        minPosition = Math.min(minPosition, position);
        if (node.thread) {
            node.thread = false;
            node.left = null;
            node.right = null;
        // confirm all leaf node is threaded
        } else if (log && !node.left && !node.right) {
            console.log(`#${node.name} is leaf but no thread`);
        }
        if (node.left) {
            setPosition1(node.left, position - node.offset);
        }
        if (node.right) {
            setPosition1(node.right, position + node.offset);
        }
    }
    setPosition1(root, 0);
    // make minposition=0
    function setPosition2(node: BinaryNode2) {
        node.position -= minPosition;
        if (node.left) {
            setPosition2(node.left);
        }
        if (node.right) {
            setPosition2(node.right);
        }
    }
    setPosition2(root);
}

// it's ok to call layout2_3's node BinaryNode3, because layout3 will work on multi children node, not binary node
interface BinaryNode3 extends BinaryNode {
    left?: BinaryNode3,
    right?: BinaryNode3,
    parent?: BinaryNode3,
    // if node.left, node.offset = node.position - node.left.position
    // if node.right, node.offset = node.right.position - node.position
    // if node.thread, node.offset = node.thread.position - node.position
    offset?: number,
    // link to next node on the boundary, only for leaf node
    // except bottom level nodes, all leaf node will link to some other node
    thread?: BinaryNode3,
}
interface BottomBoundary {
    left?: BinaryNode3,
    // node.bottomBoundary.leftOffset = node.bottomBoundary.left.position - node.position
    leftOffset?: number,
    right?: BinaryNode3,
    // node.bottomBoundary.rightOffset = node.bottomBoundary.right.position - node.position
    rightOffset?: number,
}

// minimal distance between nodes
const MinDistance = 1;

// layout2_3 my immplementation
// RESULT: exactly same in most cases, even better in not exactly same cases
function layout2_3(root: BinaryNode3) {

    // the bottomboundary parameter is information related to subtree rooted at thisnode,
    // is maintained in the setup function instance of thisnode, and used in setup function instance of thisnode.parent
    // it is called thisnode.bottomBoundary in comment calculations
    function setup(thisnode: BinaryNode3, bottomBoundary: BottomBoundary) {

        if (!thisnode.left && !thisnode.right) {
            thisnode.offset = 0;
            bottomBoundary.left = thisnode;
            bottomBoundary.leftOffset = 0;
            bottomBoundary.right = thisnode;
            bottomBoundary.rightOffset = 0;
            return;
        }

        // initialize offset according to min distance requirement
        // NOTE that min distance is distance between nodes,
        // offset is distance between thisnode and left child or right child, so need to div 2
        thisnode.offset = Math.floor((MinDistance + 1) / 2);

        // this is called thisnode.left.bottomBoundary in comment calculations
        let leftSubtreeBottomBoundary: BottomBoundary = {};
        if (thisnode.left) {
            setup(thisnode.left, leftSubtreeBottomBoundary);
            // early return when no right child
            if (!thisnode.right) {
                bottomBoundary.left = leftSubtreeBottomBoundary.left;
                // requirement: thisnode.bottomBoundary.leftOffset = thisnode.bottomBoundary.left.position - thisnode.position
                // given: thisnode.left.bottomBoundary.leftOffset = thisnode.left.bottomBoundary.left.position - thisnode.left.position
                // and now: thisnode.bottomBoundary.left is assigned thisnode.left.bottomBoundary.left
                // given: thisnode.left.position + thisnode.offset = thisnode.position
                // so append a -thisnode.offset make -thisnode.left.position becomes -thisnode.position, which is same as requirement
                bottomBoundary.leftOffset = leftSubtreeBottomBoundary.leftOffset - thisnode.offset;
                bottomBoundary.right = leftSubtreeBottomBoundary.right;
                // requirement: thisnode.bottomBoundary.rightOffset = thisnode.bottomBoundary.right.position - thisnode.position
                // given thisnode.left.bottomBoundary.rightOffset = thisnode.left.bottomBoundary.right.position - thisnode.left.position
                // so append a -thisnode.offset make -thisnode.left.position becomes -thisnode.position, which is same as requirement
                bottomBoundary.rightOffset = leftSubtreeBottomBoundary.rightOffset - thisnode.offset;
                return;
            }
        }

        // this is called thisnode.right.bottomboundary in comment calculations
        let rightSubtreeBottomBoundary: BottomBoundary = {};
        if (thisnode.right) {
            setup(thisnode.right, rightSubtreeBottomBoundary);
            // early return when no left child
            if (!thisnode.left) {
                bottomBoundary.left = rightSubtreeBottomBoundary.left;
                // requirement: thisnode.bottomBoundary.leftOffset = thisnode.bottomBoundary.left.position - thisnode.position
                // given thisnode.right.bottomBoundary.leftOffset = thisnode.right.bottomBoundary.left.position - thisnode.right.position
                // and given thisnode.right.position - thisnode.offset = thisnode.position
                // so append a +thisnode.offset make -thisnode.right.position becomes -thisnode.position, which is same as requirement
                bottomBoundary.leftOffset = rightSubtreeBottomBoundary.leftOffset + thisnode.offset;
                bottomBoundary.right = rightSubtreeBottomBoundary.right;
                // requirement: thisnode.bottomBoundary.rightOffset = thisnode.bottomBoundary.right.position - thisnode.position
                // given thisnode.right.bottomBoundary.rightOffset = thisnode.right.bottomBoundary.right.position - thisnode.right.position
                // so append a +thisnode.offset make -thisnode.right.position becomes -thisnode.position, which is same as requirement
                bottomBoundary.rightOffset = rightSubtreeBottomBoundary.rightOffset + thisnode.offset;
                return;
            }
        }
        // because single child node is early returned before, after this part,
        // thisnode.left, thisnode.right, bottomBoundary.left and bottomBoundary.right is not null

        // left cursor is in left subtree, should always stay on right boundary of left subtree
        // right cursor is in right subtree, should always stay on left boundary of right subtree
        let [leftcursor, rightcursor] = [thisnode.left, thisnode.right];
        // offset from thisnode.left to left cursor, and from thisnode.right to right cursor,
        // leftCursorOffset = leftcursor.position - thisnode.left.position
        // rightCursorOffset = rightcursor.position - thisnode.right.position
        let [leftCursorOffset, rightCursorOffset] = [0, 0];

        while (leftcursor && rightcursor) {
            // left cursor and right cursor initial value is thisnode.left and thisnode.right,
            // the initial value don't need to push apart, so for each iteration, first go down, then push apart

            if (leftcursor.thread) {
                // if it is threaded, follow thread
                // requirement: nextLeftCursorOffset = nextLeftCursor.position - thisnode.left.position
                // given prevLeftCursorOffset = prevLeftCursor.position - thisnode.left.position
                // given if node.thread, node.offset = node.thread.position - node.position
                // substitute with prevLeftCursor and nextLeftCursor: prevLeftCursor.offset = nextLeftCursor.position - prevLeftCursor.position
                // transform into prevLeftCursor.position + prevLeftCursor.offset = nextLeftCursor.position
                // so append a +prevLeftCursor.offset makes prevLeftCursor.position becomes nextLeftCursor.position, which is same as requirement
                leftCursorOffset += leftcursor.offset;
                leftcursor = leftcursor.thread;
            } else if (leftcursor.right) {
                // because prevLeftCursor.right = nextLeftCursor
                // so prevLeftCursor.position + prevLeftCursor.offset = nextLeftCursor.position
                // so append a +prevLeftCursor.offset make prevLeftCursor.position become nextLeftCursor.position, which is same as requirement
                leftCursorOffset += leftcursor.offset;
                leftcursor = leftcursor.right;
            } else {
                // prevLeftCursor.position - prevLeftCursor.offset = nextLeftCursor.position
                // so append a -prevLeftCursor.offset make prevLeftCursor.position become nextLeftCursor.position, which is same as requirement
                leftCursorOffset -= leftcursor.offset;
                leftcursor = leftcursor.left;
            }

            if (rightcursor.thread) {
                // if it is threaded, follow thread
                // requirement: nextRightCursorOffset = nextRightCursor.position - thisnode.right.position
                // given prevRightCursorOffset = prevRightCursor.position - thisnode.right.position
                // given if node.thread, node.offset = node.thread.position - node.position
                // substitute with prevRightCursor and nextRightCursor: prevRightCursor.offset = nextRightCursor.position - prevRightCursor.position
                // transform into prevRightCursor.position + prevRightCursor.offset = nextRightCursor.position
                // so append a +prevRightCursor.offset makes prevRightCursor.position becomes nextRightCursor.position, which is same as requirement
                rightCursorOffset += rightcursor.offset;
                rightcursor = rightcursor.thread;
            } else if (rightcursor.left) {
                // because prevRightCursor.left = nextRightCursor
                // so prevRightCursor.position - prevRightCursor.offset = nextRightCursor.position
                // so append a -prevRightCursor.offset make prevRightCursor.position become nextRightCursor.position, which is same as requirement
                rightCursorOffset -= rightcursor.offset;
                rightcursor = rightcursor.left;
            } else {
                // so prevRightCursor.position + prevRightCursor.offset = nextRightCursor.position
                // so append a +prevRightCursor.offset make prevRightCursor.position become nextRightCursor.position, which is same as requirement
                rightCursorOffset += rightcursor.offset;
                rightcursor = rightcursor.right;
            }

            // - !leftcursor || !rightcursor but needs to push happens when
            //   right subtree left boundary one level below left subtree bottom is even left than leftsubtree left boundary
            //   the leftCursorOffset correctly do not move and stick at left subtree bottom boundary right position, but rightsubtree right boundary position is too left
            // - calculation
            //   given thisnode.left.position + 2 * thisnode.offset = thisnode.right.position,
            //   and given leftCursorOffset = leftcursor.position - thisnode.left.position
            //   and given rightCursorOffset = rightcursor.position - thisnode.right.position
            //   so rightCursorOffset - leftCursorOffset + 2 * thisnode.offset
            //    = rightcursor.position - thisnode.right.position - (leftcursor.position - thisnode.left.position) + 2 * thisnode.offset
            //    = rightcursor.position - leftcursor.position - (thisnode.left.position + 2 * thisnode.offset - thisnode.right.position)
            //    = rightcursor.position - leftcursor.position, which is distance between left cursor and right cursor
            if (leftcursor && rightcursor && 2 * thisnode.offset + rightCursorOffset - leftCursorOffset < MinSeparation) {
                // add to required offset to make the comparison keep >=
                thisnode.offset = Math.ceil((MinSeparation + leftCursorOffset - rightCursorOffset) / 2);
                // console.log(`#${thisnode.name} push apart #${leftcursor?.name ?? '(what are you pushing?)'} and #${rightcursor?.name ?? '(what are you pushing?)'}`);
            }
        }
        // console.log(`#${thisnode.name} offset ${thisnode.offset}`);

        // maintainance bottom boundary
        if (leftcursor) {
            // left subtree is deeper than right subtree, bottom boundary is inherit thisnode.left.bottomboundary
            // this operation is same as if thisnode.right == null
            bottomBoundary.left = leftSubtreeBottomBoundary.left;
            bottomBoundary.leftOffset = leftSubtreeBottomBoundary.leftOffset - thisnode.offset;
            bottomBoundary.right = leftSubtreeBottomBoundary.right;
            bottomBoundary.rightOffset = leftSubtreeBottomBoundary.rightOffset - thisnode.offset;
        } else if (rightcursor) {
            // same as if thisnode.left == null
            bottomBoundary.left = rightSubtreeBottomBoundary.left;
            bottomBoundary.leftOffset = rightSubtreeBottomBoundary.leftOffset + thisnode.offset;
            bottomBoundary.right = rightSubtreeBottomBoundary.right;
            bottomBoundary.rightOffset = rightSubtreeBottomBoundary.rightOffset + thisnode.offset;
        } else {
            // if they are same height, then thisnode.left bottom boundary must be at left of thisnode.right bottom boundary
            bottomBoundary.left = leftSubtreeBottomBoundary.left;
            bottomBoundary.leftOffset = leftSubtreeBottomBoundary.leftOffset - thisnode.offset;
            bottomBoundary.right = rightSubtreeBottomBoundary.right;
            bottomBoundary.rightOffset = rightSubtreeBottomBoundary.rightOffset + thisnode.offset;
        }

        // create thread if necessary
        if (leftcursor) {
            // left subtree is deeper than right subtree,
            // connect right subtree bottom right boundary to left subtree right boundary at one level below right subtree bottom, which is exactly left cursor
            rightSubtreeBottomBoundary.right.thread = leftcursor;
            // requirement: if node.thread, node.offset = node.thread.position - node.position
            // requirement: thisnode.right.bottomBoundary.right.offset = leftcursor.position - thisnode.right.bottomBoundary.right.position
            // given thisnode.right.bottomBoundary.rightOffset = thisnode.right.bottomBoundary.right.position - thisnode.right.position
            // negate: -thisnode.right.bottomBoundary.rightOffset = thisnode.right.position - thisnode.right.bottomBoundary.right.position
            // given leftCursorOffset = leftcursor.position - thisnode.left.position
            // change left to right: leftCursorOffset = leftcursor.position - (thisnode.right.position - 2 * thisnode.offset)
            // transform: thisnode.right.position + leftCursorOffset - 2 * thisnode.offset = leftcursor.position
            // append +leftCursorOffset-2thisnode.offset makes thisnode.right.position becomes leftcursor.position, which is same as requirement
            rightSubtreeBottomBoundary.right.offset = leftCursorOffset - 2 * thisnode.offset - rightSubtreeBottomBoundary.rightOffset;
        } else if (rightcursor) {
            // right subtree is deeper than left subtree
            // connect left subtree bottom left boundary to right subtree left boundary at one level below left subtree bottom, which is exactly right cursor
            leftSubtreeBottomBoundary.left.thread = rightcursor;
            // requirement: if node.thread, node.offset = node.thread.position - node.position
            // requirement: thisnode.left.bottomBoundary.left.offset = rightcursor.position - thisnode.left.bottomBoundary.left.position
            // given thisnode.left.bottomBoundary.leftOffset = thisnode.left.bottomBoundary.left.position - thisnode.left.position
            // negate: -thisnode.left.bottomBoundary.leftOffset = thisnode.left.position - thisnode.left.bottomBoundary.left.position
            // given rightCursorOffset = rightcursor.position - thisnode.right.position
            // change right to left: rightCursorOffset = rightcursor.position - (thisnode.left.position + 2 * thisnode.offset)
            // transform: thisnode.left.position + rightCursorOffset + 2 * thisnode.offset = rightcursor.position
            // append +rightCursorOffset+2thisnode.offset makes thisnode.left.position becomes rightcursor.position, which is same as requirement
            leftSubtreeBottomBoundary.left.offset = rightCursorOffset + 2 * thisnode.offset - leftSubtreeBottomBoundary.leftOffset;
        } // else they are balanced, no need thread
    }

    setup(root, {});

    // after setup complete, go down left boundary of the complete tree, find leftmost offset to determine absolute position
    let cursor = root;
    let cursorOffset = 0;
    let minCursorOffset = 0;
    while (true) {
        // this is same as the right cursor logic which goes to left boundary of a subtree
        if (cursor.thread) {
            cursorOffset += cursor.offset;
            cursor = cursor.thread;
            minCursorOffset = Math.min(minCursorOffset, cursorOffset);
        } else if (cursor.left) {
            cursorOffset -= cursor.offset;
            cursor = cursor.left;
            minCursorOffset = Math.min(minCursorOffset, cursorOffset);
        } else if (cursor.right) {
            cursorOffset += cursor.offset;
            cursor = cursor.right;
            minCursorOffset = Math.min(minCursorOffset, cursorOffset);
        } else {
            break;
        }
        // console.log(`finding left contour cursor #${cursor.name} offset ${cursorOffset} minoffset ${minCursorOffset}`);
    }
    function setPosition(node: BinaryNode3, position: number) {
        node.position = position;
        if (node.left) { setPosition(node.left, position - node.offset); }
        if (node.right) { setPosition(node.right, position + node.offset); }
    }
    setPosition(root, -minCursorOffset);
}

// TODO 2_4: try avoid bottom boundary by going down left boundary of left subtree and right boundary of right subtree as well
function layout2_4(root: BinaryNode3) {

    function setup(thisnode: BinaryNode3) {

        if (!thisnode.left && !thisnode.right) {
            thisnode.offset = 0;
            return;
        }

        thisnode.offset = Math.floor((MinDistance + 1) / 2);

        if (thisnode.left) {
            setup(thisnode.left);
            // early return when no right child
            if (!thisnode.right) { return; }
        }
        if (thisnode.right) {
            setup(thisnode.right);
            // early return when no left child
            if (!thisnode.left) { return; }
        }

        let [leftcursor, rightcursor] = [thisnode.left, thisnode.right];
        let [leftCursorOffset, rightCursorOffset] = [0, 0];

        while (leftcursor && rightcursor) {

            if (leftcursor.thread) {
                leftCursorOffset += leftcursor.offset;
                leftcursor = leftcursor.thread;
            } else if (leftcursor.right) {
                leftCursorOffset += leftcursor.offset;
                leftcursor = leftcursor.right;
            } else {
                leftCursorOffset -= leftcursor.offset;
                leftcursor = leftcursor.left;
            }

            if (rightcursor.thread) {
                rightCursorOffset += rightcursor.offset;
                rightcursor = rightcursor.thread;
            } else if (rightcursor.left) {
                rightCursorOffset -= rightcursor.offset;
                rightcursor = rightcursor.left;
            } else {
                rightCursorOffset += rightcursor.offset;
                rightcursor = rightcursor.right;
            }

            if (leftcursor && rightcursor && 2 * thisnode.offset + rightCursorOffset - leftCursorOffset < MinSeparation) {
                thisnode.offset = Math.ceil((MinSeparation + leftCursorOffset - rightCursorOffset) / 2);
            }
        }


        // create thread if necessary
        if (leftcursor) {
            // left subtree is deeper than right subtree,
            // connect right subtree bottom right boundary to left subtree right boundary at one level below right subtree bottom, which is exactly left cursor
            rightSubtreeBottomBoundary.right.thread = leftcursor;
            // requirement: if node.thread, node.offset = node.thread.position - node.position
            // requirement: thisnode.right.bottomBoundary.right.offset = leftcursor.position - thisnode.right.bottomBoundary.right.position
            // given thisnode.right.bottomBoundary.rightOffset = thisnode.right.bottomBoundary.right.position - thisnode.right.position
            // negate: -thisnode.right.bottomBoundary.rightOffset = thisnode.right.position - thisnode.right.bottomBoundary.right.position
            // given leftCursorOffset = leftcursor.position - thisnode.left.position
            // change left to right: leftCursorOffset = leftcursor.position - (thisnode.right.position - 2 * thisnode.offset)
            // transform: thisnode.right.position + leftCursorOffset - 2 * thisnode.offset = leftcursor.position
            // append +leftCursorOffset-2thisnode.offset makes thisnode.right.position becomes leftcursor.position, which is same as requirement
            rightSubtreeBottomBoundary.right.offset = leftCursorOffset - 2 * thisnode.offset - rightSubtreeBottomBoundary.rightOffset;
        } else if (rightcursor) {
            // right subtree is deeper than left subtree
            // connect left subtree bottom left boundary to right subtree left boundary at one level below left subtree bottom, which is exactly right cursor
            leftSubtreeBottomBoundary.left.thread = rightcursor;
            // requirement: if node.thread, node.offset = node.thread.position - node.position
            // requirement: thisnode.left.bottomBoundary.left.offset = rightcursor.position - thisnode.left.bottomBoundary.left.position
            // given thisnode.left.bottomBoundary.leftOffset = thisnode.left.bottomBoundary.left.position - thisnode.left.position
            // negate: -thisnode.left.bottomBoundary.leftOffset = thisnode.left.position - thisnode.left.bottomBoundary.left.position
            // given rightCursorOffset = rightcursor.position - thisnode.right.position
            // change right to left: rightCursorOffset = rightcursor.position - (thisnode.left.position + 2 * thisnode.offset)
            // transform: thisnode.left.position + rightCursorOffset + 2 * thisnode.offset = rightcursor.position
            // append +rightCursorOffset+2thisnode.offset makes thisnode.left.position becomes rightcursor.position, which is same as requirement
            leftSubtreeBottomBoundary.left.offset = rightCursorOffset + 2 * thisnode.offset - leftSubtreeBottomBoundary.leftOffset;
        } // else they are balanced, no need thread
    }

    setup(root);

    // after setup complete, go down left boundary of the complete tree, find leftmost offset to determine absolute position
    let cursor = root;
    let cursorOffset = 0;
    let minCursorOffset = 0;
    while (true) {
        // this is same as the right cursor logic which goes to left boundary of a subtree
        if (cursor.thread) {
            cursorOffset += cursor.offset;
            cursor = cursor.thread;
            minCursorOffset = Math.min(minCursorOffset, cursorOffset);
        } else if (cursor.left) {
            cursorOffset -= cursor.offset;
            cursor = cursor.left;
            minCursorOffset = Math.min(minCursorOffset, cursorOffset);
        } else if (cursor.right) {
            cursorOffset += cursor.offset;
            cursor = cursor.right;
            minCursorOffset = Math.min(minCursorOffset, cursorOffset);
        } else {
            break;
        }
        // console.log(`finding left contour cursor #${cursor.name} offset ${cursorOffset} minoffset ${minCursorOffset}`);
    }
    function setPosition(node: BinaryNode3, position: number) {
        node.position = position;
        if (node.left) { setPosition(node.left, position - node.offset); }
        if (node.right) { setPosition(node.right, position + node.offset); }
    }
    setPosition(root, -minCursorOffset);
}
// TODO 2_5: use an array to store relative positions for each level, this is same time complexity and more cache friendly

// case 6: a random case looks good by layout2, not very good by layout1
allcase[6] = createBinaryTree([
    [1, 2, 6],
    [2, 3, 0],
    [3, 4, 5],
    [6, 7, 8],
    [8, 9, 26],
    [9, 10, 0],
    [10, 11, 0],
    [11, 12, 25],
    [12, 13, 24],
    [13, 0, 14],
    [14, 15, 23],
    [15, 16, 22],
    [16, 17, 21],
    [17, 0, 18],
    [18, 19, 20],
]);

// case 7: layout 2 is wider than layout 1, although looks better, is this ok?
//         UPDATE: it's common that lyout 2 is wider than layout 1, layout 2 is persueing aethentic rule 4, not narrow
allcase[7] = createBinaryTree([
    [1, 2, 28],
    [2, 3, 27],
    [3, 0, 4],
    [4, 5, 6],
    [6, 7, 0],
    [7, 8, 26],
    [8, 9, 10],
    [10, 11, 25],
    [11, 12, 24],
    [12, 13, 23],
    [13, 14, 22],
    [14, 15, 21],
    [15, 16, 0],
    [16, 17, 20],
    [17, 18, 19],
]);

// case 8, a random case layout 2 is narrower than layout 1
allcase[8] = createBinaryTree([
    [1, 2, 22],
    [2, 0, 3],
    [3, 0, 4],
    [4, 5, 6],
    [6, 0, 7],
    [7, 0, 8],
    [8, 9, 10],
    [10, 11, 0],
    [11, 12, 13],
    [13, 14, 17],
    [14, 0, 15],
    [15, 0, 16],
    [17, 18, 21],
    [18, 19, 20],
]);

// case 9, a looks more balanced random case after upgrading random tree generator
allcase[9] = createBinaryTree([
    [1, 2, 8],
    [2, 3, 6],
    [3, 4, 5],
    [6, 7, 0],
    [8, 9, 20],
    [9, 10, 19],
    [10, 11, 18],
    [11, 0, 12],
    [12, 13, 15],
    [13, 0, 14],
    [15, 16, 17],
    [20, 21, 22],
    [22, 23, 24],
]);

allcase[10] = createBinaryTree([
    [1, 2, 28],
    [2, 3, 17],
    [3, 4, 6],
    [4, 0, 5],
    [6, 0, 7],
    [7, 8, 13],
    [8, 9, 0],
    [9, 10, 11],
    [11, 12, 0],
    [13, 14, 15],
    [15, 0, 16],
    [17, 18, 19],
    [19, 20, 26],
    [20, 0, 21],
    [21, 22, 25],
    [22, 0, 23],
    [23, 24, 0],
    [26, 0, 27],
]);

// case 11: a wide tree with low height, should have many push apart cases
allcase[11] = createBinaryTree([
    [1, 2, 25],
    [2, 3, 21],
    [3, 4, 16],
    [4, 5, 11],
    [5, 0, 6],
    [6, 7, 0],
    [7, 0, 8],
    [8, 0, 9],
    [9, 0, 10],
    [11, 12, 15],
    [12, 0, 13],
    [13, 14, 0],
    [16, 17, 19],
    [17, 18, 0],
    [19, 0, 20],
    [21, 0, 22],
    [22, 23, 0],
    [23, 24, 0],
    [25, 26, 27],
]);

// case 12: manually create to see what happens when a subtree have kind of flat bottom (more than 2 nodes at bottom)
// RESULT: correctly finds leftmost and rightmost in bottom level, also correct when leftmost and rightmost is in different branch
allcase[12] = createBinaryTree([
    [1, 2, 3],
    [2, 4, 0],
    [3, 0, 5],
]);

// case 13: obvious empty column from layout1
allcase[13] = createBinaryTree([
    [1, 2, 22],
    [2, 3, 18],
    [3, 0, 4],
    [4, 5, 11],
    [5, 6, 10],
    [6, 7, 8],
    [8, 0, 9],
    [11, 12, 14],
    [12, 13, 0],
    [14, 0, 15],
    [15, 16, 17],
    [18, 19, 21],
    [19, 0, 20],
    [22, 23, 30],
    [23, 24, 25],
    [25, 26, 0],
    [26, 0, 27],
    [27, 28, 29],
]);

// case 14: layout2_1 and layout2_2 provides not optimal #1.offset = 3 result
// while layout1_3 and layout2_3 correctly gives #1.offset = 2 result
// this is because of the original ROOTSEP design is not precise enough comparing to layout2_3's directly calculate thisnode.offset design
// amazingly this situation does not appear again in later about 30 random case manual checks, so add automatic mechanism for that
allcase[14] = createBinaryTree([
    [1, 2, 8],
    [2, 0, 3],
    [3, 4, 0],
    [4, 5, 0],
    [5, 0, 6],
    [6, 0, 7],
    [8, 9, 10],
    [10, 11, 0],
    [11, 12, 14],
    [12, 13, 0],
    [14, 15, 0],
    [15, 16, 0],
]);

// case 15: a not very special random tree with 30 nodes and layout2s are 2 blocks better
allcase[15] = createBinaryTree([
    [1, 2, 9],
    [2, 3, 6],
    [3, 0, 4],
    [4, 5, 0],
    [6, 7, 0],
    [7, 8, 0],
    [9, 10, 20],
    [10, 11, 0],
    [11, 12, 0],
    [12, 13, 16],
    [13, 14, 15],
    [16, 17, 0],
    [17, 18, 0],
    [18, 0, 19],
    [20, 21, 24],
    [21, 0, 22],
    [22, 0, 23],
    [24, 25, 0],
    [25, 0, 26],
    [26, 27, 29],
    [27, 0, 28],
    [29, 30, 0],
]);

// case 16: a looks good random tree
allcase[16] = createBinaryTree([
    [1, 2, 19],
    [2, 3, 0],
    [3, 4, 6],
    [4, 5, 0],
    [6, 7, 9],
    [7, 8, 0],
    [9, 10, 15],
    [10, 11, 12],
    [12, 13, 0],
    [13, 0, 14],
    [15, 16, 17],
    [17, 18, 0],
    [19, 0, 20],
    [20, 21, 22],
    [22, 0, 23],
]);

// case 17: layout2s are 4 blocks better than layout1
allcase[17] = createBinaryTree([
    [1, 2, 4],
    [2, 3, 0],
    [4, 5, 7],
    [5, 0, 6],
    [7, 8, 10],
    [8, 0, 9],
    [10, 11, 14],
    [11, 12, 0],
    [12, 0, 13],
    [14, 15, 22],
    [15, 16, 21],
    [16, 17, 18],
    [18, 0, 19],
    [19, 0, 20],
    [22, 23, 0],
    [23, 0, 24],
    [24, 0, 25],
    [25, 0, 26],
]);

// case 18: another case14 find by auto mechanism
allcase[18] = createBinaryTree([
    [1, 2, 39],
    [2, 3, 24],
    [3, 4, 8],
    [4, 0, 5],
    [5, 0, 6],
    [6, 7, 0],
    [8, 9, 0],
    [9, 10, 20],
    [10, 11, 0],
    [11, 12, 14],
    [12, 0, 13],
    [14, 0, 15],
    [15, 16, 17],
    [17, 18, 0],
    [18, 0, 19],
    [20, 21, 22],
    [22, 23, 0],
    [24, 25, 26],
    [26, 27, 29],
    [27, 28, 0],
    [29, 30, 34],
    [30, 31, 33],
    [31, 0, 32],
    [34, 35, 36],
    [36, 37, 0],
    [37, 0, 38],
    [39, 40, 46],
    [40, 41, 42],
    [42, 43, 44],
    [44, 45, 0],
    [46, 47, 48],
    [48, 49, 50]
]);

function autotest2_3() {
    let T = 100;
    while (T--) {
        const tree = generateBinaryTree2(50);
        layout2_2(tree);
        const map2 = collectLayoutResult(tree);
        layout2_3(tree);
        const map3 = collectLayoutResult(tree);
        const [keys2, keys3] = [new Set(map2.keys()), new Set(map3.keys())];
        const same = (() => {
            if (!keys2.isSubsetOf(keys3) || !keys3.isSubsetOf(keys2)) { return false; }
            for (const nodeName of keys2) {
                if (map2.get(nodeName) != map3.get(nodeName)) { return false; }
            }
            return true;
        })();
        if (!same) {
            console.log(`not ok: #${100 - T}`);
            notPrettyPrintBinaryTree(tree);
            break;
        }
    }
}

let tree: BinaryNode;
if (process.argv[2] == 'auto2_3') {
    autotest2_3();
    process.exit(0);
} else if (process.argv[2]) {
    tree = allcase[+process.argv[2]];
    if (!tree) {
        console.log(`invalid case id ${process.argv[2]}`);
        process.exit(1);
    }
} else {
    tree = generateBinaryTree2();
}
notPrettyPrintBinaryTree(tree);

const tree1 = tree as BinaryNode1;
layout1_3(tree1);
veryPrettyPrintBinaryTree(tree1);
// maybeClearerPrettyPrintBinaryTree(tree1);
const tree2 = tree as BinaryNode2;
layout2_1(tree2);
veryPrettyPrintBinaryTree(tree2);
// maybeClearerPrettyPrintBinaryTree(tree2);
layout2_2(tree2, false);
// kindOfPrettyPrintBinaryTree(tree2);
veryPrettyPrintBinaryTree(tree2);
// maybeClearerPrettyPrintBinaryTree(tree2);
const tree3 = tree as BinaryNode3;
layout2_3(tree3);
veryPrettyPrintBinaryTree(tree3);
// maybeClearerPrettyPrintBinaryTree(tree3);
