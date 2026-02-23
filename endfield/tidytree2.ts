import fs from 'node:fs/promises';

// see tidytree.ts for background information

// upgrade aesthentic rules
// - nodes should be centered over its subtree means node is centered over its leftmost descendent and rightmost descendent

// TODO paper 3 seems only improve the problem that small subtrees between large subtrees is stacked at left side of available space, 
// which may be not important in my actual requirement, while paper 4 solve the issue that paper 3 is not working in linear time,
// so first expand binary tree final solution to generic tree on my own, and check the paper 3 issues,
// if ok, goes to recipe.html first and invetigate later

interface Node {
    name: number,
    children: Node[],
    position: number,
    depth: number, // start from 0
}

function randomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateTree(size: number = 0): Node {
    size = size || randomInt(20, 60);
    let nodeNameIndex = 1;

    const root: Node = { name: nodeNameIndex++, children: [], position: 0, depth: 0 };
    const queue: Node[] = [root];
    let nodeCount = 1;
    
    while (nodeCount < size && queue.length > 0) {
        const parent = queue.shift();
        const maxChildren = randomInt(1, 5);
        const childrenCount = Math.min(maxChildren, size - nodeCount);
        
        for (let i = 0; i < childrenCount; i++) {
            const child: Node = { name: nodeNameIndex++, children: [], position: 0, depth: parent.depth + 1 };
            parent.children.push(child);
            queue.push(child);
            nodeCount++;
        }
    }
    
    return root;
}

// item is [parent, ...childrenNames], ignore 0 to be compatible with binary tree test case
// to make depth easier, relationships should order from top to bottom
function createTree(relationships: number[][]): Node {
    const maxName = relationships.reduce((m, r) => Math.max(m, ...r), 0);
    const nodes = Array.from(new Array(maxName).fill(0).keys()).map<Node>(i => ({ name: i + 1, children: [], depth: 0, position: 0 }));
    for (const [nodeName, ...childrenNames] of relationships) {
        const node = nodes[nodeName - 1];
        // ignore 0 name to be compatible with binary tree test case
        for (const childName of childrenNames.filter(n => n)) {
            const child = nodes[childName - 1];
            child.depth = node.depth + 1;
            node.children.push(child);
        }
    }
    return nodes[0];
}

function preOrderVisit(node: Node, f: (node: Node) => void) {
    f(node);
    for (const child of node.children) {
        preOrderVisit(child, f);
    }
}
function postOrderVisit(node: Node, f: (node: Node) => void) {
    for (const child of node.children) {
        postOrderVisit(child, f);
    }
    f(node);
}

function printTreeEdges(node: Node) {
    if (node.children.length) {
        console.log(`[${node.name}, ${node.children.map(c => c.name).join(', ')}],`);
    }
    for (const child of node.children) {
        printTreeEdges(child);
    }
}
// if the tree cannot be printed by prettyprint (overlaped position or too wide)
// use this more primitive but still can work version
function printTreePositions(root: Node) {
    let maxDepth = 0;
    const allNodes: Node[] = [];
    preOrderVisit(root, node => {
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
function prettyPrintTree(root: Node) {
    let maxDepth = 0;
    const allNodes: Node[] = [];
    preOrderVisit(root, node => {
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

// if (!process.argv[2]) {
//     console.log(`missing argv[2] as test case if you are running this code`);
//     process.exit(1);
// }
// const binaryTree = createBinaryTree(allcases[+process.argv[2] - 1]);

// -----------------------------------------
// -------------- PAPER 3 ------------------
// -----------------------------------------

interface Node {
    // when setup, node.position is used for preliminary position,
    // which is node.preliminaryPosition = node.position - node.parent.position
    position: number,
    thread?: Node,
    // thread relative position, because node.position is already used for 
    // relative position to parent, so need another property for this relative position,
    // to make the relative position usage more consistent,
    // this is node.thread.threadOffset = node.thread.position - node.position
    threadOffset?: number,
}

const MinDistance = 1;
// layout1: try expand 2_3 to generic trees
function layout1(root: Node, log: boolean = false) {

    function setup(thisnode: Node) {
        // nothing to do for leaf node (relative position is now in child nodes,
        // leaf node don't need to manage position by itself), so skip leaf node
        for (const child of thisnode.children.filter(c => c.children.length)) { setup(child); }

        // if children count = 1, then the subtree already put subtree root at middle,
        // then you need to put thisnode at middle, which means result child relative position is 0
        if (thisnode.children.length == 1) {
            thisnode.children[0].position = 0;
            return;
        }

        const childCount = thisnode.children.length;
        const childIndexSequence = new Array(childCount).fill(0).map((_, i) => i);
        // assign initial position to childrens
        for (const childIndex of childIndexSequence) {
            thisnode.children[childIndex].position = childIndex * MinDistance;
        }

        if (log) { console.log(`#${thisnode.name} children [${thisnode.children.map(c => c.name).join(', ')}]`); }

        // most left descendant position, leftmostDescendantPosition = leftmostNode.position - node.children[0].position
        let leftmostDescendantPosition = 0;
        // most right descendant position, rightmostDescendantPosition = rightmostNode.position - node.children[0].position
        let rightmostDescendantPosition = (thisnode.children.length - 1) * MinDistance;
        // child index => left cursor node
        // ATTENTION: this is the left boundary of all children subtrees, is NOT same as bin tree solution's left subtree right boundary cursor
        const leftCursors = thisnode.children.map(n => n);
        // leftCursorOffsets[childIndex] = leftCursors[childIndex].position - thisnode.children[childIndex].position
        // ATTENTION: this is the relative position of left boundaries of child subtrees, is not same as bin tree solution's left subtree right boundary cursor
        const leftCursorOffsets = thisnode.children.map(() => 0);
        // child index => right cursor node
        // ATTENTION: this is the right boundary of all children subtrees, is NOT same as bin tree solution's right subtree left boundary cursor
        const rightCursors = thisnode.children.map(n => n);
        // rightCursorOffsets[childIndex] = rightCursors[childIndex].position - thisnode.children[childIndex].position
        // ATTENTION: this is the relative position of right boundaries of child subtrees, is not same as bin tree solution's right subtree left boundary cursor
        const rightCursorOffsets = thisnode.children.map(() => 0);

        // active child indexes, start from all children indexes, remove from this list if the subtree is exhausted
        // find active siblings to push apart and leftmost and rightmost subtree index to find leftmost and rightmost descendant
        let activeIndexes = childIndexSequence.map(i => i);

        // add a hard loop count limit to help debug
        let loopCount = 0;
        // go down both side of all child subtrees at the same time
        // - for intermediate boundaries, push apart them and record relative position in child node
        //   e.g. children[1] right boundary and children[2] left boundary have overlap, push apart to min distance and add to children[2].position
        // - for leftmost subtree and rightmost subtree, go down at the same time and record leftmost node position and rightmost node position
        //   when a leftmost subtree is exhausted, it is removed from runningindexes and another subtree becomes the new leftmost subtree,
        //   connect previous leftmost subtree left boundary node to new leftmost subtree current left cursor and continue finding leftmost node position
        // - this avoids duplicate threading mechanism in intermediate boundaries, and looks very COOL
        while (activeIndexes.length) {
            if (log) {
                console.log(`  begin loop, activeIndexes = ${activeIndexes.join(',')}`);
                console.log(`  leftCursors = ${childIndexSequence.map(i => `[${i}]=#${leftCursors[i]?.name ?? '()'},${leftCursorOffsets[i]}`).join(',')}`);
                console.log(`  rightCursors = ${childIndexSequence.map(i => `[${i}]=#${rightCursors[i]?.name ?? '()'},${rightCursorOffsets[i]}`).join(',')}`);
            }

            // first go down all boundaries of all subtrees if active
            for (const childIndex of childIndexSequence) {
                if (leftCursors[childIndex] && leftCursors[childIndex].thread) {
                    if (log) { console.log(`  subtree[${childIndex}] left cursor go down from #${leftCursors[childIndex].name} to thread #${
                        leftCursors[childIndex].thread.name} offset ${leftCursorOffsets[childIndex]} reduce ${leftCursors[childIndex].thread.threadOffset}`); }
                    leftCursors[childIndex] = leftCursors[childIndex].thread;
                    // TODO proof the sign
                    leftCursorOffsets[childIndex] -= leftCursors[childIndex].threadOffset;
                } else if (leftCursors[childIndex] && leftCursors[childIndex].children.length) {
                    if (log) { console.log(`  subtree[${childIndex}] left cursor go down from #${leftCursors[childIndex].name} to #${leftCursors[childIndex].children[
                        leftCursors[childIndex].children.length - 1].name} offset ${leftCursorOffsets[childIndex]} reduce ${leftCursors[childIndex].children[leftCursors[childIndex].children.length - 1].position}`); }
                    leftCursors[childIndex] = leftCursors[childIndex].children[leftCursors[childIndex].children.length - 1];
                    // TODO proof the sign
                    leftCursorOffsets[childIndex] -= leftCursors[childIndex].position;
                } else if (leftCursors[childIndex] && (childIndex != activeIndexes[0] || activeIndexes.length == 1)) {
                    // - normally go down null
                    //   if is leftmost subtree, stay here for later thread operation, a null right cursor of this subtree will indicate this situation
                    //   *while in this exception*, still go down null when only one remaining subtree, or else the loop does not end, no need to thread when only one active subtree
                    // - second leftmost subtree may go down null at the same time, but threading only adds
                    //   on leftmost subtree last node and new leftmost subtree current cursor, second leftmost subtree last node is not relevant
                    if (log) { console.log(`  subtree[${childIndex}] left cursor go down from ${leftCursors[childIndex].name} to null`); }
                    leftCursors[childIndex] = null;
                } else {
                    if (log) { console.log(`  subtree[${childIndex}] left cursor stay`); }
                }

                if (rightCursors[childIndex] && rightCursors[childIndex].thread) {
                    if (log) { console.log(`  subtree[${childIndex}] right cursor go down from #${rightCursors[childIndex].name} to thread #${
                        rightCursors[childIndex].thread.name} offset ${rightCursorOffsets[childIndex]} increase ${rightCursors[childIndex].thread.threadOffset}`); }
                    rightCursors[childIndex] = rightCursors[childIndex].thread;
                    // TODO proof the sign
                    rightCursorOffsets[childIndex] += rightCursors[childIndex].threadOffset;
                } else if (rightCursors[childIndex] && rightCursors[childIndex].children.length) {
                    if (log) { console.log(`  subtree[${childIndex}] right cursor go down from #${rightCursors[childIndex].name} to #${
                        rightCursors[childIndex].children[0].name} offset ${rightCursorOffsets[childIndex]} reduce ${rightCursors[childIndex].children[0].position}`); }
                    rightCursors[childIndex] = rightCursors[childIndex].children[0];
                    // TODO proof the sign
                    rightCursorOffsets[childIndex] += rightCursors[childIndex].position;
                } else if (rightCursors[childIndex] && (childIndex != activeIndexes[activeIndexes.length - 1] || activeIndexes.length == 1)) {
                    // - normally go down null
                    //   if is rightmost subtree, stay here for later thread operation, a null left cursor of this subtree will indicate this situation
                    //   *while in this exception*, still go down null when only one remaining subtree, or else the loop does not end, no need to thread when only one active subtree
                    // - second rightmost subtree may go down null at the same time, but threading only adds
                    //   on rightmost subtree last node and new rightmost subtree current cursor, second rightmost subtree last node is not relevant
                    if (log) { console.log(`  subtree[${childIndex}] right cursor go down from #${rightCursors[childIndex].name} to null`); }
                    rightCursors[childIndex] = null;
                } else {
                    if (log) { console.log(`  subtree[${childIndex}] right cursor stay`); }
                }
            }

            // update active indexes, check leftmost subtree's right boundary, others check left boundary
            const newActiveIndexes = activeIndexes.filter((childIndex, i) => i == 0 ? rightCursors[childIndex] : leftCursors[childIndex]);

            // push apart
            if (newActiveIndexes.length > 1) {
                for (const [leftIndex, rightIndex] of new Array(newActiveIndexes.length - 1)
                    .fill(0).map<[number, number]>((_, i) => [newActiveIndexes[i], newActiveIndexes[i + 1]]))
                {
                    let distance = 0;
                    // base distance of the 2 subtrees
                    for (let childIndex = leftIndex + 1; childIndex <= rightIndex; childIndex++) {
                        distance += thisnode.children[childIndex].position;
                    }
                    // TODO proof the calculation
                    if (distance + rightCursorOffsets[leftIndex] + leftCursorOffsets[rightIndex] < MinDistance) {
                        // adjust rightIndex subtree
                        thisnode.children[rightIndex].position = MinDistance - leftCursorOffsets[rightIndex] - rightCursorOffsets[leftIndex];
                        if (log) { console.log(`  push apart #${thisnode.children[leftIndex].name} and #${thisnode.children[rightIndex].name} new offset ${thisnode.children[rightIndex].position}`); }
                    }
                }
            }

            // manage thread, this use activeIndexes instead of newActiveIndexes
            if (activeIndexes.length > 1 && !rightCursors[activeIndexes[0]]) {
                // distance between prev leftmost child and next leftmost child
                let totalDistance = 0;
                // leftmost subtree is exhaused, connect to next leftmost subtree left boundary
                // ATTENTION this is activeIndex's index
                let nextLeftmostChildIndexIndex = 1;
                // skip second leftmost subtree and even more subtrees if they are exhaused at the same time
                // add up their base positions at the same time
                while (nextLeftmostChildIndexIndex < activeIndexes.length && !leftCursors[activeIndexes[nextLeftmostChildIndexIndex]]) {
                    totalDistance += thisnode.children[activeIndexes[nextLeftmostChildIndexIndex]].position;
                    nextLeftmostChildIndexIndex += 1;
                }
                // equal means all subtrees exhaused at the exactly same time, which is normal for second bottom level
                if (nextLeftmostChildIndexIndex < activeIndexes.length) {
                    const nextLeftmostChildIndex = activeIndexes[nextLeftmostChildIndexIndex];
                    totalDistance += thisnode.children[nextLeftmostChildIndex].position;
                    if (log) { console.log(`  thread from subtree[${activeIndexes[0]}] last left cursor #${leftCursors[activeIndexes[0]].name} to subtree[${
                        nextLeftmostChildIndex}] left cursor #${leftCursors[nextLeftmostChildIndex].name}, store offset ${leftCursorOffsets[nextLeftmostChildIndex] - leftCursorOffsets[activeIndexes[0]] + totalDistance}`); }
                    leftCursors[activeIndexes[0]].thread = leftCursors[nextLeftmostChildIndex];
                    // ATTENTION don't forget offset is in .thread target node, not source node
                    // TODO proof the calculation
                    leftCursors[nextLeftmostChildIndex].threadOffset = leftCursorOffsets[nextLeftmostChildIndex] - leftCursorOffsets[activeIndexes[0]] + totalDistance;
                }
            }
            let rightmostChildIndex = activeIndexes[activeIndexes.length - 1];
            if (activeIndexes.length > 1 && !leftCursors[rightmostChildIndex]) {
                // distance between prev leftmost child and next leftmost child
                let totalDistance = 0;
                // rightmost subtree is exhaused, connect to next rightmost subtree right boundary
                // ATTENTION this is activeIndex's index
                let nextRightmostChildIndexIndex = activeIndexes.length - 2;
                // skip second rightmost subtree and even more subtrees if they are exhaused at the same time
                while (nextRightmostChildIndexIndex >= 0 && !rightCursors[activeIndexes[nextRightmostChildIndexIndex]]) {
                    totalDistance += thisnode.children[activeIndexes[nextRightmostChildIndexIndex]].position;
                    nextRightmostChildIndexIndex -= 1;
                }
                // less means all subtrees exhaused at the exactly same time, which is normal for second bottom level
                if (nextRightmostChildIndexIndex >= 0) {
                    const nextRightmostChildIndex = activeIndexes[nextRightmostChildIndexIndex];
                    totalDistance += thisnode.children[nextRightmostChildIndex].position;
                    if (log) { console.log(`  thread from subtree[${rightmostChildIndex}] last right cursor #${rightCursors[rightmostChildIndex].name} to subtree[${
                        nextRightmostChildIndex}] left cursor #${rightCursors[nextRightmostChildIndex].name}, store offset ${rightCursorOffsets[nextRightmostChildIndex] - rightCursorOffsets[rightmostChildIndex] + totalDistance}`); }
                    rightCursors[activeIndexes[rightmostChildIndex]].thread = rightCursors[nextRightmostChildIndex];
                    // TODO proof the calculation
                    rightCursors[nextRightmostChildIndex].threadOffset = rightCursorOffsets[nextRightmostChildIndex] - rightCursorOffsets[rightmostChildIndex] + totalDistance;
                    rightmostChildIndex = nextRightmostChildIndex;
                }
            }

            activeIndexes = newActiveIndexes;
            if (activeIndexes.length) {
                // now the cursors in activeIndexes are at the next level, then collect leftmost and rightmost descendant
                leftmostDescendantPosition = Math.min(leftmostDescendantPosition, leftCursorOffsets[activeIndexes[0]]);
                // rightmost position is also relative to thisnode.children[0],
                // so need to add up all the gaps between thisnode.children[0] and current rightmost active subtree base position
                let basePosition = 0;
                for (let childIndex = 1; childIndex <= rightmostChildIndex; childIndex++) {
                    basePosition += thisnode.children[childIndex].position;
                }
                // TODO proof the calculation
                rightmostDescendantPosition = Math.max(rightmostDescendantPosition, rightCursorOffsets[rightmostChildIndex] + basePosition);
                if (log) { console.log(`  end loop, leftmostDescendantPosition ${leftmostDescendantPosition} rightmostDescendantPosition ${rightmostDescendantPosition}`); }
            } else {
                console.log(`  end loop`);
            }

            loopCount += 1;
            if (loopCount > 20) { console.log('abort!'); process.exit(1); }
        } // this is end of the main loop if you lost track

        // thisnode.position if thisnode.children[0].position is 0
        const thisPosition = Math.floor((leftmostDescendantPosition + rightmostDescendantPosition) / 2);
        // update child positions based on regard thisnode.position is 0
        thisnode.children.forEach(child => child.position -= thisPosition);
        if (log) { console.log(`  result this position ${thisPosition}`); }
        if (log) { console.log(`  result child positions ${thisnode.children.map(c => `#${c.name}=${c.position}`).join(',')}`); }
    }
    setup(root);

    let cursor = root;
    let cursorPosition = 0;
    let minCursorPosition = 0;
    while (true) {
        if (cursor.thread) {
            cursor = cursor.thread;
            // TODO sync sign with leftcursor logic
            cursorPosition += cursor.threadOffset;
            minCursorPosition = Math.min(minCursorPosition, cursorPosition);
        } else if (cursor.children.length) {
            cursor = cursor.children[0];
            cursorPosition += cursor.position;
            minCursorPosition = Math.min(minCursorPosition, cursorPosition);
        } else {
            break;
        }
        // console.log(`finding left contour cursor #${cursor.name} offset ${cursorOffset} minoffset ${minCursorOffset}`);
    }
    function setPosition(node: Node, position: number) {
        node.position = position;
        for (const child of node.children) {
            setPosition(child, position + child.position);
        }
    }
    setPosition(root, -minCursorPosition);
}

const allcases: Node[] = JSON.parse(await fs
    .readFile('trees.json', 'utf-8')).map((v: number[][]) => createTree(v.filter(r => typeof r != 'string')));

// case 20: a normal random tree to check crash issues: update fixed crash
allcases.push(createTree([
    [1, 2, 3, 4],
    [2, 5],
    [5, 15, 16, 17],
    [3, 6, 7, 8, 9],
    [6, 18],
    [7, 19, 20, 21, 22, 23],
    [8, 24],
    [9, 25, 26, 27, 28, 29],
    [4, 10, 11, 12, 13, 14],
    [10, 30, 31, 32, 33, 34],
    [11, 35, 36, 37, 38],
]));

// case 21: a normal random case that will crash, update: fixed crash
allcases.push(createTree([
    [1, 2],
    [2, 3, 4, 5, 6, 7],
    [3, 8, 9],
    [8, 20],
    [9, 21, 22, 23],
    [4, 10, 11],
    [10, 24],
    [11, 25, 26, 27, 28, 29],
    [5, 12, 13, 14, 15, 16],
    [12, 30],
    [6, 17],
    [7, 18, 19],
]));

// case 22: this make pretty print crash, update: fixed crash
allcases.push(createTree([
    [1, 2, 3, 4, 5],
    [2, 6, 7],
    [6, 14, 15, 16, 17, 18],
    [14, 41, 42, 43],
    [15, 44, 45, 46],
    [16, 47],
    [17, 48, 49],
    [18, 50, 51],
    [7, 19, 20, 21, 22],
    [19, 52, 53],
    [20, 54, 55, 56],
    [3, 8],
    [8, 23, 24, 25],
    [4, 9, 10, 11, 12],
    [9, 26, 27, 28],
    [10, 29, 30, 31, 32, 33],
    [11, 34, 35],
    [12, 36, 37, 38, 39],
    [5, 13],
    [13, 40],
]));

// case 23: manually created to check errors
allcases.push(createTree([
    [1, 2, 3, 4, 5],
    [2, 6, 7, 8, 9],
]));

let tree: Node;
if (process.argv[2]) {
    tree = allcases[+process.argv[2] - 1];
    if (!tree) {
        console.log(`invalid case id ${process.argv[2]}`);
        process.exit(1);
    }
} else {
    tree = generateTree();
}
layout1(tree, true);
printTreeEdges(tree);
printTreePositions(tree);
prettyPrintTree(tree);
