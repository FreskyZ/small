
// To make the production tree beautiful, you need...

// Tree Drawing Algorithms
// [1] C. Wetherell and A. Shannon, Tidy drawimgs of trees. IEEE Transactions on Software Engineering, vol. SE-5, pp. 514-520, 1979.
// [2] E.Reingold and J.Tilford. Tidier drawings of trees. IEEE Transactions on Software Engineering, 7(2):223–228, 1981.
// [3] J.Walker II. A node-positioning algorithm for general trees. Software–Practice and Experience, 20(7):685–705, 1990.
// // why is this citation so long
// [4] C. Buchheim, M. J¨unger, and S. Leipert. Improving Walker’s Algorithm to Run in Linear Time. In M. T. Goodrich and S. G.
//     Kobourov, editors, Graph Drawing, volume 2528 of Lecture Notes in Computer Science, pages 344–353. Springer Berlin Heidelberg, 2002.

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
const case1 = createBinaryTree([
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
const case2 = createBinaryTree([
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
const case3 = createBinaryTree([
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
const case4 = createBinaryTree([
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
const case5 = createBinaryTree([
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
NODE = RECORD
    INFO: INTEGER;
    LLINK,
    RLINK: LINK; (* POINTERS TO SUBTREES *)
    XCOORD,
    YCOORD: INTEGER; (* COORDINATES OF THIS NODE *)
    OFFSET: INTEGER; (* DISTANCE TO EACH SON *)
    THREAD: BOOLEAN
END;
TYPE LINK = ^NODE;

EXTREME = RECORD
    ADDR: LINK;
    OFF: INTEGER;
    LEV: INTEGER
END;

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
    offset?: number,
    thread?: boolean,
}

interface OutmostNode {
    node: BinaryNode2,
    offset: number,
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

        const leftSubtreeLeftmost: OutmostNode = { node: null, offset: 0, depth: -1 };
        const leftSubtreeRightmost: OutmostNode = { node: null, offset: 0, depth: -1 };
        const rightSubtreeLeftmost: OutmostNode = { node: null, offset: 0, depth: -1 };
        const rightSubtreeRightmost: OutmostNode = { node: null, offset: 0, depth: -1 };
        if (node.left) {
            setup(node.left, leftSubtreeLeftmost, leftSubtreeRightmost);
        }
        if (node.right) {
            setup(node.right, rightSubtreeLeftmost, rightSubtreeRightmost);
        }

        let thisSeparation = MinSeparation; // separation of parameter node
        let currentSeparation = MinSeparation; // separation in following iteration
        let leftTotalOffset = 0; // offset from leftmost to node
        let rightTotalOffset = 0; // offset from rightmost to node

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

        node.offset = Math.floor((thisSeparation + 1) / 2);
        leftTotalOffset -= node.offset;
        rightTotalOffset += node.offset;

        if (!node.left || rightSubtreeLeftmost.depth > leftSubtreeLeftmost.depth) {
            leftmost.node = rightSubtreeLeftmost.node;
            leftmost.depth = rightSubtreeLeftmost.depth;
            leftmost.offset = rightSubtreeLeftmost.offset + node.offset;
        } else {
            leftmost.node = leftSubtreeLeftmost.node;
            leftmost.depth = leftSubtreeLeftmost.depth;
            leftmost.offset = leftSubtreeLeftmost.offset + node.offset;
        }
        if (!node.right || leftSubtreeRightmost.depth > rightSubtreeRightmost.depth) {
            rightmost.node = leftSubtreeRightmost.node;
            rightmost.depth = leftSubtreeRightmost.depth;
            rightmost.offset = leftSubtreeRightmost.offset - node.offset;
        } else {
            rightmost.node = rightSubtreeRightmost.node;
            rightmost.depth = rightSubtreeRightmost.depth;
            rightmost.offset = rightSubtreeRightmost.offset + node.offset;
        }

        if (left && left.name != node.left.name) {
            rightSubtreeRightmost.node.thread = true;
            rightSubtreeRightmost.node.offset = Math.abs(rightSubtreeRightmost.offset + node.offset - leftTotalOffset);
            if (leftTotalOffset - node.offset <= rightSubtreeRightmost.offset) {
                rightSubtreeRightmost.node.left = left;
            } else {
                rightSubtreeRightmost.node.right = left;
            }
        } else if (right && right.name != node.right.name) {
            leftSubtreeLeftmost.node.thread = true;
            leftSubtreeLeftmost.node.offset = Math.abs(leftSubtreeLeftmost.offset - node.offset - rightTotalOffset);
            if (rightTotalOffset + node.offset >= leftSubtreeLeftmost.offset) {
                leftSubtreeLeftmost.node.right = right;
            } else {
                leftSubtreeLeftmost.node.left = right;
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
    // TODO the paper skips the function to find the leftmost position to determine root node's absolute position
    petrify(root, 1);
}

// AI converted version
function layout2_2(root: BinaryNode2) {
    /**
     * This procedure implements algorithm TR, assigning relative positionings
     * to all nodes in the tree pointed to by parameter node.
     */
    function setup(node: BinaryNode2 | null, depth: number, rightmost: OutmostNode, leftmost: OutmostNode): void {

        if (!node.right && !node.left) {
            // Leaf node is both leftmost and rightmost
            rightmost.node = node;
            leftmost.node = node;
            rightmost.depth = depth;
            leftmost.depth = depth;
            rightmost.offset = 0;
            leftmost.offset = 0;
            node.offset = 0;
            return;
        }

        const leftSubtreeRightmost: OutmostNode = { node: null, offset: 0, depth: -1 };
        const leftSubtreeLeftmost: OutmostNode = { node: null, offset: 0, depth: -1 };
        const rightSubtreeRightmost: OutmostNode = { node: null, offset: 0, depth: -1 };
        const rightSubtreeLeftmost: OutmostNode = { node: null, offset: 0, depth: -1 };
        // Position subtrees recursively
        if (node.left) {
            setup(node.left, depth + 1, leftSubtreeRightmost, leftSubtreeLeftmost);
        }
        if (node.right) {
            setup(node.right, depth + 1, rightSubtreeRightmost, rightSubtreeLeftmost);
        }
        
        // Node is not a leaf

        // Set up for subtree pushing. Place roots of
        // subtrees minimum distance apart.
        let currentSeparation = MinSeparation;
        let thisSeparation = MinSeparation;
        let leftTotalOffset = 0;
        let rightTotalOffset = 0;
    
        let left = node.left;      // Follows contour of left subtree
        let right = node.right;    // Follows contour of right subtree

        // Now consider each level in turn until one
        // subtree is exhausted, pushing the subtrees
        // apart when necessary.
        while (left && right) {
            if (currentSeparation < MinSeparation) {
                thisSeparation += MinSeparation - currentSeparation;
                currentSeparation = MinSeparation;
            }

            // Advance left & right pointers
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

        // Set the offset in node, and include it in
        // accumulated offsets for left and right
        node.offset = Math.floor((thisSeparation + 1) / 2);
        leftTotalOffset -= node.offset;
        rightTotalOffset += node.offset;

        // Update extreme descendants information
        if (!node.left || rightSubtreeLeftmost.depth > leftSubtreeLeftmost.depth) {
            leftmost.node = rightSubtreeLeftmost.node;
            leftmost.offset = rightSubtreeLeftmost.offset + node.offset;
        } else {
            leftmost.node = leftSubtreeLeftmost.node;
            leftmost.offset = leftSubtreeLeftmost.offset - node.offset;
        }

        if (!node.right || leftSubtreeRightmost.depth > rightSubtreeRightmost.depth) {
            rightmost.node = leftSubtreeRightmost.node;
            rightmost.offset = leftSubtreeRightmost.offset - node.offset;
        } else {
            rightmost.node = rightSubtreeRightmost.node;
            rightmost.offset = rightSubtreeRightmost.offset + node.offset;
        }

        // If subtrees of node were of uneven heights, check
        // to see if threading is necessary. At most one
        // thread needs to be inserted.

        if (left && left.name != node.left.name) {
            if (rightSubtreeRightmost.node) {
                rightSubtreeRightmost.node.thread = true;
                rightSubtreeRightmost.node.offset = Math.abs(rightSubtreeRightmost.offset + node.offset - leftTotalOffset);
                if (leftTotalOffset - node.offset <= rightSubtreeRightmost.offset) {
                    rightSubtreeRightmost.node.left = left;
                } else {
                    rightSubtreeRightmost.node.right = left;
                }
            }
        } else if (right && right.name != node.right.name) {
            if (leftSubtreeLeftmost.node) {
                leftSubtreeLeftmost.node.thread = true;
                leftSubtreeLeftmost.node.offset = Math.abs(leftSubtreeLeftmost.offset - node.offset - rightTotalOffset);
                if (rightTotalOffset + node.offset >= leftSubtreeLeftmost.offset) {
                    leftSubtreeLeftmost.node.right = right;
                } else {
                    leftSubtreeLeftmost.node.left = right;
                }
            }
        }
    }

    /**
     * This procedure performs a preorder traversal of the tree,
     * converting the relative offsets to absolute coordinates.
     */
    function petrify(node: BinaryNode2 | null, position: number): void {
        node.position = position;
        if (node.thread) {
            node.thread = false;
            node.right = null;
            node.left = null; // Threaded node must be a leaf
        }
        if (node.left) { petrify(node.left, position - node.offset); }
        if (node.right) { petrify(node.right, position + node.offset); }
    }
    
    const [rootLeftmost, rootRightmost] = [{ node: null, offset: 0, depth: -1 }, { node: null, offset: 0, depth: -1 }];
    setup(root, 0, rootLeftmost, rootRightmost);
    // console.log(rootLeftmost, rootRightmost);
    // TODO the paper skips the function to find the leftmost position to determine root node's absolute position
    petrify(root, 1);
}

const tree1 = case5 as BinaryNode1;
notPrettyPrintBinaryTree(tree1);
layout1_3(tree1);
veryPrettyPrintBinaryTree(tree1);

const tree2 = tree1 as BinaryNode2;
layout2_1(tree2);
veryPrettyPrintBinaryTree(tree2);
layout2_2(tree2);
// kindOfPrettyPrintBinaryTree(tree2);
veryPrettyPrintBinaryTree(tree2);
