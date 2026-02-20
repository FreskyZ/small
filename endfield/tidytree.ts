
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

// -----------------------------------------
// -------------- PAPER 1 ------------------
// -----------------------------------------

interface BinaryNode1 extends BinaryNode {
    left?: BinaryNode1,
    right?: BinaryNode1,
    parent?: BinaryNode1,
    modifier: number,
}
function generateRandomBinaryTree(): BinaryNode {
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

function notPrettyPrintBinaryTree(node: BinaryNode) {
    if (node.left || node.right) {
        console.log(`${node.name}: ${node.left?.name ?? ''}, ${node.right?.name ?? ''}`);
    }
    if (node.left) { notPrettyPrintBinaryTree(node.left); }
    if (node.right) { notPrettyPrintBinaryTree(node.right); }
}
function notVeryPrettyPrintBinaryTree(root: BinaryNode) {
    // naive print result if pretty print have some issue
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
function prettyPrintBinaryTree(root: BinaryNode) {
    
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
                sb += `#${node.name}`.padStart(4);
            } else {
                sb += ''.padStart(4);
            }
        }
        console.log(sb);
    }
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

// paper 1 algorithm 3, 1_2 is different from 1_1 in paper 2 fig 1 tree, fixed
function layout1_3(root: BinaryNode1, log: boolean = false) {

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

// // layout1_3 is ok (exactly same) according to manual inspection
// const treeRandom = generateRandomBinaryTree() as BinaryNode1;
// notPrettyPrintBinaryTree(treeRandom);
// layout1_1(treeRandom);
// prettyPrintBinaryTree(treeRandom);
// layout1_2(treeRandom);
// console.log();
// prettyPrintBinaryTree(treeRandom);
// layout1_3(treeRandom);
// console.log();
// prettyPrintBinaryTree(treeRandom);

// // paper 1 fig 5
// const node1: BinaryNode1 = { name: 1, depth: 0, position: 0, modifier: 0 };
// const node2: BinaryNode1 = { name: 2, parent: node1, depth: 1, position: 0, modifier: 0 };
// const node3: BinaryNode1 = { name: 3, parent: node1, depth: 1, position: 0, modifier: 0 };
// node1.left = node2; node1.right = node3;
// const node4: BinaryNode1 = { name: 4, parent: node2, depth: 2, position: 0, modifier: 0 };
// const node5: BinaryNode1 = { name: 5, parent: node2, depth: 2, position: 0, modifier: 0 };
// node2.left = node4; node2.right = node5;
// const node6: BinaryNode1 = { name: 6, parent: node3, depth: 2, position: 0, modifier: 0 };
// node3.right = node6;
// const node7: BinaryNode1 = { name: 7, parent: node5, depth: 3, position: 0, modifier: 0 };
// const node8: BinaryNode1 = { name: 8, parent: node5, depth: 3, position: 0, modifier: 0 };
// node5.left = node7; node5.right = node8;
// const node9: BinaryNode1 = { name: 9, parent: node6, depth: 3, position: 0, modifier: 0 };
// node6.right = node9;
// const node10: BinaryNode1 = { name: 10, parent: node9, depth: 4, position: 0, modifier: 0 };
// node9.left = node10;
// const node11: BinaryNode1 = { name: 11, parent: node10, depth: 5, position: 0, modifier: 0 };
// const node12: BinaryNode1 = { name: 12, parent: node10, depth: 5, position: 0, modifier: 0 };
// node10.left = node11; node10.right = node12;
// const node13: BinaryNode1 = { name: 13, parent: node11, depth: 6, position: 0, modifier: 0 };
// const node14: BinaryNode1 = { name: 14, parent: node11, depth: 6, position: 0, modifier: 0 };
// node11.left = node13; node11.right = node14;
// layout1_1(node1);
// prettyPrintBinaryTree(node1);
// layout1_2(node1);
// console.log();
// prettyPrintBinaryTree(node1);
// layout1_3(node1);
// console.log();
// prettyPrintBinaryTree(node1);

// // paper 1 fig 8
// const node1: BinaryNode1 = { name: 1, depth: 0, position: 0, modifier: 0 };
// const node2: BinaryNode1 = { name: 2, depth: 1, parent: node1, position: 0, modifier: 0 };
// const node3: BinaryNode1 = { name: 3, depth: 1, parent: node1, position: 0, modifier: 0 };
// node1.left = node2; node1.right = node3;
// const node4: BinaryNode1 = { name: 4, depth: 2, parent: node2, position: 0, modifier: 0 };
// const node5: BinaryNode1 = { name: 5, depth: 2, parent: node2, position: 0, modifier: 0 };
// node2.left = node4; node2.right = node5;
// const node6: BinaryNode1 = { name: 6, depth: 2, parent: node3, position: 0, modifier: 0 };
// const node7: BinaryNode1 = { name: 7, depth: 2, parent: node3, position: 0, modifier: 0 };
// node3.left = node6; node3.right = node7;
// const node8: BinaryNode1 = { name: 8, depth: 3, parent: node7, position: 0, modifier: 0 };
// const node9: BinaryNode1 = { name: 9, depth: 3, parent: node7, position: 0, modifier: 0 };
// node7.left = node8; node7.right = node9;
// const node10: BinaryNode1 = { name: 10, depth: 4, parent: node8, position: 0, modifier: 0 };
// node8.right = node10;
// const node11: BinaryNode1 = { name: 11, depth: 5, parent: node10, position: 0, modifier: 0 };
// node10.right = node11;
// const node12: BinaryNode1 = { name: 12, depth: 6, parent: node11, position: 0, modifier: 0 };
// node11.right = node12;
// const node13: BinaryNode1 = { name: 13, depth: 7, parent: node12, position: 0, modifier: 0 };
// node12.right = node13;
// layout1_1(node1);
// prettyPrintBinaryTree(node1);
// layout1_2(node1);
// console.log();
// prettyPrintBinaryTree(node1);
// layout1_3(node1);
// console.log();
// prettyPrintBinaryTree(node1);

// // paper 2 fig 1, this have unwanted shift right at node#15
// const nodes = Array.from(new Array(31).fill(0).keys()).map<BinaryNode1>(i => ({ name: i + 1, depth: 0, position: 0, modifier: 0 }));
// // item is [parent, left, right],
// // left and right is 0 for null,
// // to make depth easier, should order from top to bottom
// const relationships = [
//     [1, 2, 3],
//     [2, 4, 5],
//     [3, 6, 7],
//     [4, 8, 9],
//     [7, 10, 11],
//     [8, 12, 13],
//     [11, 14, 15],
//     [12, 16, 17],
//     [15, 18, 19],
//     [17, 20, 21],
//     [18, 22, 23],
//     [21, 24, 25],
//     [22, 26, 27],
//     [25, 28, 29],
//     [26, 30, 31],
// ];
// for (const [nodeName, leftName, rightName] of relationships) {
//     const node = nodes[nodeName - 1];
//     if (leftName > 0) {
//         node.left = nodes[leftName - 1];
//         node.left.parent = node;
//         node.left.depth = node.depth + 1;
//     }
//     if (rightName > 0) {
//         node.right = nodes[rightName - 1];
//         node.right.parent = node;
//         node.right.depth = node.depth + 1;
//     }
// }
// layout1_1(nodes[0]);
// prettyPrintBinaryTree(nodes[0]);
// layout1_2(nodes[0]);
// prettyPrintBinaryTree(nodes[0]);
// layout1_3(nodes[0]);
// prettyPrintBinaryTree(nodes[0]);

// // another paper 2 fig 1-like 2 not same with 1,3 case
// const nodes = Array.from(new Array(31).fill(0).keys()).map<BinaryNode1>(i => ({ name: i + 1, depth: 0, position: 0, modifier: 0 }));
// const relationships = [
//     [1, 2, 4],
//     [2, 0, 3],
//     [4, 5, 26],
//     [5, 6, 25],
//     [6, 7, 24],
//     [7, 8, 0],
//     [8, 9, 0],
//     [9, 10, 23],
//     [10, 11, 0],
//     [11, 0, 12],
//     [12, 13, 0],
//     [13, 14, 22],
//     [14, 15, 21],
//     [15, 16, 0],
//     [16, 17, 0],
//     [17, 18, 20],
//     [18, 0 , 19],
// ];
// for (const [nodeName, leftName, rightName] of relationships) {
//     const node = nodes[nodeName - 1];
//     if (leftName > 0) {
//         node.left = nodes[leftName - 1];
//         node.left.parent = node;
//         node.left.depth = node.depth + 1;
//     }
//     if (rightName > 0) {
//         node.right = nodes[rightName - 1];
//         node.right.parent = node;
//         node.right.depth = node.depth + 1;
//     }
// }
// layout1_1(nodes[0]);
// prettyPrintBinaryTree(nodes[0]);
// layout1_2(nodes[0]);
// prettyPrintBinaryTree(nodes[0]);
// layout1_3(nodes[0]);
// prettyPrintBinaryTree(nodes[0]);

// // paper 2 fig 5 shows paper 1 produce different subtree even though they are same structure
// // this seems to refer to modified WS (1_4), which is not implemented here, but original WS (1_1 and 1_3) also have this issue
// const nodes = Array.from(new Array(17).fill(0).keys()).map<BinaryNode1>(i => ({ name: i + 1, depth: 0, position: 0, modifier: 0 }));
// // item is [parent, left, right],
// // left and right is 0 for null,
// // to make depth easier, should order from top to bottom
// const relationships = [
//     [1, 2, 3],
//     [3, 4, 5],
//     [4, 6, 0],
//     [6, 0, 9],
//     [5, 7, 8],
//     [8, 10, 11],
//     [10, 12, 0],
//     [11, 13, 14],
//     [12, 0, 15],
//     [13, 0, 16],
//     [14, 17, 0],
// ];
// for (const [nodeName, leftName, rightName] of relationships) {
//     const node = nodes[nodeName - 1];
//     if (leftName > 0) {
//         node.left = nodes[leftName - 1];
//         node.left.parent = node;
//         node.left.depth = node.depth + 1;
//     }
//     if (rightName > 0) {
//         node.right = nodes[rightName - 1];
//         node.right.parent = node;
//         node.right.depth = node.depth + 1;
//     }
// }
// layout1_1(nodes[0]);
// prettyPrintBinaryTree(nodes[0]);
// layout1_2(nodes[0]);
// prettyPrintBinaryTree(nodes[0]);
// layout1_3(nodes[0]);
// prettyPrintBinaryTree(nodes[0]);

// -----------------------------------------
// -------------- PAPER 2 ------------------
// -----------------------------------------
