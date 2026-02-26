import fs from 'node:fs/promises';

// see tidytree.ts for background information

// upgrade aesthetic rules
// - nodes should be centered over its subtree means node is centered over its leftmost descendent and rightmost descendent

interface Node {
    name: number,
    children: Node[],
    position: number,
    depth: number, // start from 0
}

function round(value: number, decimalPlace: number = 0) {
    const multiplier = Math.pow(10, decimalPlace);
    return Math.round(value * multiplier) / multiplier;
}
// debug display normally use round2
const round2 = (value: number) => round(value, 2);

function randomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateTree(size: number = 0): Node {
    size = size || randomInt(20, 80);
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
            sb += `#${node.name} at ${round2(node.position)}, `;
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
        const maxPosition = thisDepthNodes.reduce((m, n) => Math.max(m, Math.round(n.position)), 0);
        for (const position of new Array(maxPosition + 1).fill(0).keys()) {
            if (thisDepthNodes.filter(n => Math.round(n.position) == position).length > 1) {
                console.log(`!!! depth ${depth} position ${position} have overlapped nodes`);
            }
            const node = thisDepthNodes.find(n => Math.round(n.position) == position);
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
// by the way https://en.wikipedia.org/wiki/Box-drawing_characters

interface Node1 extends Node {
    children: Node1[],
    // when setup, node.position is used for preliminary position,
    // which is node.preliminaryPosition = node.position - node.parent.position
    // position: number,
    thread?: Node1,
    // thread relative position, because node.position is already used for 
    // relative position to parent, so need another property for this relative position,
    // this cannot be put in node2 in "node1.thread = node2",
    // because a node can appear in both left boundary and right boundary of a subtree, e.g. [1, 2, 3, 4], [3, 5]
    // so, this is node.threadOffset = node.thread.position - node.position
    threadOffset?: number,
}

const MinDistance = 1;
// layout1: try expand 2_3 to generic trees
function layout1(root: Node1, stat: { logs?: string[] }) {
    stat.logs = [];
    const log = (record: string) => stat.logs.push(record);

    function setup(thisnode: Node1) {
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
        childIndexSequence.forEach(childIndex => thisnode.children[childIndex].position = childIndex == 0 ? 0 : MinDistance);

        log(`#${thisnode.name} children [${thisnode.children.map(c => c.name).join(', ')}]`);
    
        // active child indexes, start from all children indexes, remove from this list if the subtree is exhausted
        // find active siblings to push apart and leftmost and rightmost subtree index to find leftmost and rightmost descendant
        let activeIndexes = childIndexSequence.map(i => i);
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

        // most left descendant position, leftmostDescendantPosition = leftmostNode.position - node.children[0].position
        let leftmostDescendantPosition = 0;
        // - leftmost descendant can be compared cross iterations, but rightmost node may be pushed apart in later loops,
        //   cannot simply record single value relative to thisnode.children[0], need to record rightmost node for each subtree and compare them later
        // - not all subtree may record rightmost node, if a subtree is shadowed by a right side subtree, no rightmost node recorded
        // child index => rightmostNode.position - node.children[childIndex].position, initialize with the rightmost child
        let rightmostNodes = childIndexSequence.map(childIndex =>
            childIndex == childCount - 1 ? { node: thisnode.children[childIndex], offset: 0 } : { node: null, offset: undefined });

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
            log(`  begin loop, activeIndexes = ${activeIndexes.join(',')}`);
            log(`  leftCursors = ${childIndexSequence.map(i => `[${i}]=#${leftCursors[i]?.name ?? '()'},${round2(leftCursorOffsets[i])}`).join(',')}`);
            log(`  rightCursors = ${childIndexSequence.map(i => `[${i}]=#${rightCursors[i]?.name ?? '()'},${round2(rightCursorOffsets[i])}`).join(',')}`);

            // first go down all boundaries of all subtrees if active
            for (const childIndex of activeIndexes) {
                if (leftCursors[childIndex].thread) {
                    log(`  subtree[${childIndex}] left cursor go down from #${leftCursors[childIndex].name} to thread #${
                        leftCursors[childIndex].thread.name} offset ${round2(leftCursorOffsets[childIndex])} increase ${round2(leftCursors[childIndex].threadOffset)}`);
                    // thisnode.children[childIndex].position + oldCursorOffsets[childIndex] = oldCursors[childIndex].position
                    // oldCursors[childIndex].position + threadOffset = newCursors[childIndex]
                    // require thisnode.children[childIndex].position + newCursorOffsets[childIndex] = newCursors[childIndex].position
                    // so +threadOffset meets the requirement
                    leftCursorOffsets[childIndex] += leftCursors[childIndex].threadOffset;
                    leftCursors[childIndex] = leftCursors[childIndex].thread;
                } else if (leftCursors[childIndex].children.length) {
                    log(`  subtree[${childIndex}] left cursor go down from #${leftCursors[childIndex].name} to #${
                        leftCursors[childIndex].children[0].name} offset ${round2(leftCursorOffsets[childIndex])} increase ${round2(leftCursors[childIndex].children[0].position)}`);
                    leftCursors[childIndex] = leftCursors[childIndex].children[0];
                    // similar to threadOffset, need to add newLeftCursor.position - oldLeftCursor.position, which is exactly the preliminary position stored in node
                    leftCursorOffsets[childIndex] += leftCursors[childIndex].position;
                } else if (childIndex != activeIndexes[0] || activeIndexes.length == 1) {
                    // - normally go down null
                    //   if is leftmost subtree, stay here for later thread operation, a null right cursor of this subtree will indicate this situation
                    //   *while in this exception*, still go down null when only one remaining subtree, or else the loop does not end, no need to thread when only one active subtree
                    // - second leftmost subtree may go down null at the same time, but threading only adds
                    //   on leftmost subtree last node and new leftmost subtree current cursor, second leftmost subtree last node is not relevant
                    log(`  subtree[${childIndex}] left cursor go down from #${leftCursors[childIndex].name} to null`);
                    leftCursors[childIndex] = null;
                } else {
                    log(`  subtree[${childIndex}] left cursor stay at #${leftCursors[childIndex].name}`);
                }

                if (rightCursors[childIndex].thread) {
                    log(`  subtree[${childIndex}] right cursor go down from #${rightCursors[childIndex].name} to thread #${
                        rightCursors[childIndex].thread.name} offset ${round2(rightCursorOffsets[childIndex])} increase ${round2(rightCursors[childIndex].threadOffset)}`);
                    // thisnode.children[childIndex].position + oldCursorOffsets[childIndex] = oldCursors[childIndex].position
                    // oldCursors[childIndex].position + threadOffset = newCursors[childIndex]
                    // require thisnode.children[childIndex].position + newCursorOffsets[childIndex] = newCursors[childIndex].position
                    // so +threadOffset meets the requirement
                    rightCursorOffsets[childIndex] += rightCursors[childIndex].threadOffset;
                    rightCursors[childIndex] = rightCursors[childIndex].thread;
                } else if (rightCursors[childIndex].children.length) {
                    log(`  subtree[${childIndex}] right cursor go down from #${rightCursors[childIndex].name} to #${
                        rightCursors[childIndex].children[rightCursors[childIndex].children.length - 1].name} offset ${round2(rightCursorOffsets[
                        childIndex])} increase ${round2(rightCursors[childIndex].children[rightCursors[childIndex].children.length - 1].position)}`);
                    rightCursors[childIndex] = rightCursors[childIndex].children[rightCursors[childIndex].children.length - 1];
                    // similar to threadOffset, need to add newLeftCursor.position - oldLeftCursor.position, which is exactly the preliminary position stored in node
                    rightCursorOffsets[childIndex] += rightCursors[childIndex].position;
                } else if (childIndex != activeIndexes[activeIndexes.length - 1] || activeIndexes.length == 1) {
                    // - normally go down null
                    //   if is rightmost subtree, stay here for later thread operation, a null left cursor of this subtree will indicate this situation
                    //   *while in this exception*, still go down null when only one remaining subtree, or else the loop does not end, no need to thread when only one active subtree
                    // - second rightmost subtree may go down null at the same time, but threading only adds
                    //   on rightmost subtree last node and new rightmost subtree current cursor, second rightmost subtree last node is not relevant
                    log(`  subtree[${childIndex}] right cursor go down from #${rightCursors[childIndex].name} to null`);
                    rightCursors[childIndex] = null;
                } else {
                    log(`  subtree[${childIndex}] right cursor stay at #${rightCursors[childIndex].name}`);
                }
            }

            // update active indexes, check leftmost subtree's right boundary, others check left boundary
            const newActiveIndexes = activeIndexes.filter((childIndex, i) => i == 0 ? rightCursors[childIndex] : leftCursors[childIndex]);
            // push apart
            if (newActiveIndexes.length > 1) {
                for (const [leftIndex, rightIndex] of new Array(newActiveIndexes.length - 1)
                    .fill(0).map<[number, number]>((_, i) => [newActiveIndexes[i], newActiveIndexes[i + 1]]))
                {
                    let subtreeDistance = 0;
                    // base distance of the 2 subtrees
                    for (let childIndex = leftIndex + 1; childIndex <= rightIndex; childIndex++) {
                        subtreeDistance += thisnode.children[childIndex].position;
                    }
                    // given thisnode.children[leftIndex].position + subtreeDistance = thisnode.children[rightIndex].position
                    // given thisnode.children[leftIndex].position + rightCursorOffsets[leftIndex] = rightCursors[leftIndex].position
                    // given thisnode.children[rightIndex].position + leftCursorOffsets[rightIndex] = leftCursors[rightIndex].position
                    // require calculation of leftCursors[rightIndex].position - leftCursor[leftIndex].position
                    // which is thisnode.children[rightIndex].position + leftCursorOffsets[rightIndex] - thisnode.children[leftIndex].position - rightCursorOffsets[leftIndex]
                    // which is subtreeDistance + leftCursorOffsets[rightIndex] - rightCursorOffsets[leftIndex]
                    if (subtreeDistance + leftCursorOffsets[rightIndex] - rightCursorOffsets[leftIndex] < MinDistance) {
                        // adjust rightIndex subtree
                        thisnode.children[rightIndex].position += MinDistance - leftCursorOffsets[rightIndex] + rightCursorOffsets[leftIndex] - subtreeDistance;
                        log(`  push apart #${thisnode.children[leftIndex].name} and #${thisnode.children[rightIndex].name} new offset ${round2(thisnode.children[rightIndex].position)}`);
                    }
                }
            }

            // manage thread, this use activeIndexes instead of newActiveIndexes
            let leftmostChildIndex = activeIndexes[0];
            if (activeIndexes.length > 1 && !rightCursors[leftmostChildIndex]) {
                // distance between prev leftmost child and next leftmost child
                let subtreeDistance = 0;
                // leftmost subtree is exhaused, connect to next leftmost subtree left boundary
                // ATTENTION this is activeIndex's index
                let nextLeftmostChildIndexIndex = 1;
                // skip second leftmost subtree and even more subtrees if they are exhaused at the same time
                // add up their base positions at the same time
                while (nextLeftmostChildIndexIndex < activeIndexes.length && !leftCursors[activeIndexes[nextLeftmostChildIndexIndex]]) {
                    subtreeDistance += thisnode.children[activeIndexes[nextLeftmostChildIndexIndex]].position;
                    nextLeftmostChildIndexIndex += 1;
                }
                // equal means all subtrees exhaused at the exactly same time, which is normal for second bottom level
                if (nextLeftmostChildIndexIndex < activeIndexes.length) {
                    const nextLeftmostChildIndex = activeIndexes[nextLeftmostChildIndexIndex];
                    subtreeDistance += thisnode.children[nextLeftmostChildIndex].position;
                    log(`  thread from subtree[${leftmostChildIndex}] last left cursor #${leftCursors[leftmostChildIndex].name} to subtree[${
                        nextLeftmostChildIndex}] left cursor #${leftCursors[nextLeftmostChildIndex].name}, thread offset ${leftCursorOffsets[nextLeftmostChildIndex] - leftCursorOffsets[leftmostChildIndex] + subtreeDistance}`);
                    leftCursors[leftmostChildIndex].thread = leftCursors[nextLeftmostChildIndex];
                    // ATTENTION don't forget offset is in .thread target node, not source node
                    // thisnode.children[oldIndex].position + subtreeDistance = thisnode.children[newIndex].position
                    // thisnode.children[oldIndex].position + cursorOffsets[oldIndex] = cursors[oldIndex].position
                    // thisnode.children[newIndex].position + cursorOffsets[newIndex] = cursors[newIndex].position
                    // require cursors[oldIndex].position + threadOffset = cursors[newIndex.position]
                    // so threadOffset = cursors[newIndex].position - cursors[oldIndex].position
                    //                 = thisnode.children[newIndex].position + cursorOffsets[newIndex] - thisnode.children[oldIndex].position + cursorOffsets[oldIndex]
                    //                 = subtreeDistance + cursorOffsets[newIndex] - cursorOffsets[oldIndex]
                    leftCursors[leftmostChildIndex].threadOffset = leftCursorOffsets[nextLeftmostChildIndex] - leftCursorOffsets[leftmostChildIndex] + subtreeDistance;
                    leftmostChildIndex = nextLeftmostChildIndex;
                }
            }
            let rightmostChildIndex = activeIndexes[activeIndexes.length - 1];
            if (activeIndexes.length > 1 && !leftCursors[rightmostChildIndex]) {
                // distance between prev rightmost child and next rightmost child
                // ATTENTION children[childIndex].position is always relative to left,
                // so left and right thread management is not same here, left boundary add last position later, right boundary add first position here
                let subtreeDistance = thisnode.children[rightmostChildIndex].position;
                // rightmost subtree is exhaused, connect to next rightmost subtree right boundary
                // ATTENTION this is activeIndex's index
                let nextRightmostChildIndexIndex = activeIndexes.length - 2;
                // skip second rightmost subtree and even more subtrees if they are exhaused at the same time
                while (nextRightmostChildIndexIndex >= 0 && !rightCursors[activeIndexes[nextRightmostChildIndexIndex]]) {
                    subtreeDistance += thisnode.children[activeIndexes[nextRightmostChildIndexIndex]].position;
                    nextRightmostChildIndexIndex -= 1;
                }
                // <0 means all subtrees exhaused at the exactly same time, which is normal for second bottom level
                if (nextRightmostChildIndexIndex >= 0) {
                    const nextRightmostChildIndex = activeIndexes[nextRightmostChildIndexIndex];
                    log(`  thread from subtree[${rightmostChildIndex}] last right cursor #${rightCursors[rightmostChildIndex]
                        .name} to subtree[${nextRightmostChildIndex}] right cursor #${rightCursors[nextRightmostChildIndex].name}, thread offset ${
                            rightCursorOffsets[nextRightmostChildIndex] - rightCursorOffsets[rightmostChildIndex] - subtreeDistance}`);
                    rightCursors[rightmostChildIndex].thread = rightCursors[nextRightmostChildIndex];
                    // ATTENTION newIndex is at left of oldIndex, the first expression is reversed compared to left thread
                    // thisnode.children[newIndex].position + subtreeDistance = thisnode.children[oldIndex].position
                    // thisnode.children[oldIndex].position + cursorOffsets[oldIndex] = cursors[oldIndex].position
                    // thisnode.children[newIndex].position + cursorOffsets[newIndex] = cursors[newIndex].position
                    // require cursors[oldIndex].position + threadOffset = cursors[newIndex.position]
                    // so threadOffset = cursors[newIndex].position - cursors[oldIndex].position
                    //                 = thisnode.children[newIndex].position + cursorOffsets[newIndex] - thisnode.children[oldIndex].position + cursorOffsets[oldIndex]
                    //                 = -subtreeDistance + cursorOffsets[newIndex] - cursorOffsets[oldIndex]
                    rightCursors[rightmostChildIndex].threadOffset = rightCursorOffsets[nextRightmostChildIndex] - rightCursorOffsets[rightmostChildIndex] - subtreeDistance;
                    rightmostChildIndex = nextRightmostChildIndex;
                }
            }

            activeIndexes = newActiveIndexes;
            if (activeIndexes.length) {
                // now the cursors in activeIndexes are at the next level, then collect leftmost and rightmost descendant
                log(`  original leftmostDescendantPosition ${round2(leftmostDescendantPosition)} current leftmost node #${
                    leftCursors[leftmostChildIndex].name} position ${round2(leftCursorOffsets[leftmostChildIndex])}`);
                // thisnode.children[0].position + leftCursorOffsets[childIndex] = leftCursors[childIndex].position
                // thisnode.children[0].position + leftmostDescendantPosition = leftmostDescendantNode.position
                // so can directly use leftCursorOffsets[leftmostChildIndex]
                leftmostDescendantPosition = Math.min(leftmostDescendantPosition, leftCursorOffsets[leftmostChildIndex]);

                log(`  original rightmostNodes[${rightmostChildIndex}] #${rightmostNodes[rightmostChildIndex].node?.name ?? '()'},${
                    rightmostNodes[rightmostChildIndex].offset ?? ''}, current rightmost node #${rightCursors[rightmostChildIndex].name} offset ${rightCursorOffsets[rightmostChildIndex]}`);
                if (!rightmostNodes[rightmostChildIndex].node || rightmostNodes[rightmostChildIndex].offset < rightCursorOffsets[rightmostChildIndex]) {
                    rightmostNodes[rightmostChildIndex].node = rightCursors[rightmostChildIndex];
                    rightmostNodes[rightmostChildIndex].offset = rightCursorOffsets[rightmostChildIndex];
                }
            }

            loopCount += 1;
            if (loopCount > 20) { console.log('abort!'); process.exit(1); }
            log(`  end loop`);
        } // this is end of the main loop if you lost track

        let subtreeDistance = 0;
        let rightmostDescendantPosition = 0;
        for (const childIndex of childIndexSequence) {
            if (childIndex != 0) {
                subtreeDistance += thisnode.children[childIndex].position;
            }
            if (rightmostNodes[childIndex].node) {
                log(`  rightmost node in subtree[${childIndex}] is #${rightmostNodes[childIndex].node.name} offset (${subtreeDistance}) ${rightmostNodes[childIndex].offset}`);
                rightmostDescendantPosition = Math.max(rightmostDescendantPosition, subtreeDistance + rightmostNodes[childIndex].offset);
            }
        }

        // children positions are relative position to left sibling child after the loop,
        // convert them to relative position to thisnode, or thisnode.position + thisnode.children[childIndex].preliminaryPosition = thisnode.children[childIndex].position
        // avg(leftmost, rightmost) is thisnode's position regarding thisnode.children[0]'s position as 0, so -avg is expected thisnode.children[0].position
        // NOTE keep floating point positions here and align to grid when finally rendering
        let currentPosition = -(leftmostDescendantPosition + rightmostDescendantPosition) / 2;
        for (const child of thisnode.children) {
            currentPosition = child.position += currentPosition;
        }
        log(`  result child positions ${thisnode.children.map(c => `#${c.name}=${c.position}`).join(',')}`);
    }
    setup(root);

    log(`complete tree left contour`);
    let cursor = root;
    let cursorPosition = 0;
    let minCursorPosition = 0;
    while (true) {
        if (cursor.thread) {
            cursorPosition += cursor.threadOffset;
            cursor = cursor.thread;
            minCursorPosition = Math.min(minCursorPosition, cursorPosition);
        } else if (cursor.children.length) {
            cursor = cursor.children[0];
            cursorPosition += cursor.position;
            minCursorPosition = Math.min(minCursorPosition, cursorPosition);
        } else {
            break;
        }
        log(`  cursor #${cursor.name} position ${round2(cursorPosition)} minoffset ${round2(minCursorPosition)}`);
    }
    function setPosition(node: Node1, position: number) {
        node.position = position;
        node.thread = null;
        node.threadOffset = undefined;
        for (const child of node.children) {
            setPosition(child, position + child.position);
        }
    }
    setPosition(root, -minCursorPosition);
}

// layout2: even distribute push apart distance if they are not sibling subtree
function layout2(root: Node1, stat: { logs?: string[] }) {
    stat.logs = [];
    const log = (record: string) => stat.logs.push(record);

    function setup(thisnode: Node1) {
        for (const child of thisnode.children.filter(c => c.children.length)) { setup(child); }

        if (thisnode.children.length == 1) { thisnode.children[0].position = 0; return; }

        const childCount = thisnode.children.length;
        const childIndexSequence = new Array(childCount).fill(0).map((_, i) => i);
        childIndexSequence.forEach(childIndex => thisnode.children[childIndex].position = childIndex == 0 ? 0 : MinDistance);

        log(`#${thisnode.name} children [${thisnode.children.map(c => c.name).join(', ')}]`);
    
        let activeIndexes = childIndexSequence.map(i => i);
        const leftCursors = thisnode.children.map(n => n);
        const leftCursorOffsets = thisnode.children.map(() => 0);
        const rightCursors = thisnode.children.map(n => n);
        const rightCursorOffsets = thisnode.children.map(() => 0);

        let leftmostDescendantPosition = 0;
        let rightmostNodes = childIndexSequence.map(childIndex =>
            childIndex == childCount - 1 ? { node: thisnode.children[childIndex], offset: 0 } : { node: null, offset: undefined });

        let loopCount = 0;
        while (activeIndexes.length) {
            log(`  begin loop, activeIndexes = ${activeIndexes.join(',')}`);
            log(`  leftCursors = ${childIndexSequence.map(i => `[${i}]=#${leftCursors[i]?.name ?? '()'},${round2(leftCursorOffsets[i])}`).join(',')}`);
            log(`  rightCursors = ${childIndexSequence.map(i => `[${i}]=#${rightCursors[i]?.name ?? '()'},${round2(rightCursorOffsets[i])}`).join(',')}`);

            for (const childIndex of activeIndexes) {
                if (leftCursors[childIndex].thread) {
                    log(`  subtree[${childIndex}] left cursor go down from #${leftCursors[childIndex].name} to thread #${
                        leftCursors[childIndex].thread.name} offset ${round2(leftCursorOffsets[childIndex])} increase ${round2(leftCursors[childIndex].threadOffset)}`);
                    leftCursorOffsets[childIndex] += leftCursors[childIndex].threadOffset;
                    leftCursors[childIndex] = leftCursors[childIndex].thread;
                } else if (leftCursors[childIndex].children.length) {
                    log(`  subtree[${childIndex}] left cursor go down from #${leftCursors[childIndex].name} to #${
                        leftCursors[childIndex].children[0].name} offset ${round2(leftCursorOffsets[childIndex])} increase ${round2(leftCursors[childIndex].children[0].position)}`);
                    leftCursors[childIndex] = leftCursors[childIndex].children[0];
                    leftCursorOffsets[childIndex] += leftCursors[childIndex].position;
                } else if (childIndex != activeIndexes[0] || activeIndexes.length == 1) {
                    log(`  subtree[${childIndex}] left cursor go down from #${leftCursors[childIndex].name} to null`);
                    leftCursors[childIndex] = null;
                } else {
                    log(`  subtree[${childIndex}] left cursor stay at #${leftCursors[childIndex].name}`);
                }

                if (rightCursors[childIndex].thread) {
                    log(`  subtree[${childIndex}] right cursor go down from #${rightCursors[childIndex].name} to thread #${
                        rightCursors[childIndex].thread.name} offset ${round2(rightCursorOffsets[childIndex])} increase ${round2(rightCursors[childIndex].threadOffset)}`);
                    rightCursorOffsets[childIndex] += rightCursors[childIndex].threadOffset;
                    rightCursors[childIndex] = rightCursors[childIndex].thread;
                } else if (rightCursors[childIndex].children.length) {
                    log(`  subtree[${childIndex}] right cursor go down from #${rightCursors[childIndex].name} to #${
                        rightCursors[childIndex].children[rightCursors[childIndex].children.length - 1].name} offset ${round2(rightCursorOffsets[
                        childIndex])} increase ${round2(rightCursors[childIndex].children[rightCursors[childIndex].children.length - 1].position)}`);
                    rightCursors[childIndex] = rightCursors[childIndex].children[rightCursors[childIndex].children.length - 1];
                    rightCursorOffsets[childIndex] += rightCursors[childIndex].position;
                } else if (childIndex != activeIndexes[activeIndexes.length - 1] || activeIndexes.length == 1) {
                    log(`  subtree[${childIndex}] right cursor go down from #${rightCursors[childIndex].name} to null`);
                    rightCursors[childIndex] = null;
                } else {
                    log(`  subtree[${childIndex}] right cursor stay at #${rightCursors[childIndex].name}`);
                }
            }

            const newActiveIndexes = activeIndexes.filter((childIndex, i) => i == 0 ? rightCursors[childIndex] : leftCursors[childIndex]);
            if (newActiveIndexes.length > 1) {
                for (const [leftIndex, rightIndex] of new Array(newActiveIndexes.length - 1)
                    .fill(0).map<[number, number]>((_, i) => [newActiveIndexes[i], newActiveIndexes[i + 1]]))
                {
                    let subtreeDistance = 0;
                    for (let childIndex = leftIndex + 1; childIndex <= rightIndex; childIndex++) {
                        subtreeDistance += thisnode.children[childIndex].position;
                    }
                    if (subtreeDistance + leftCursorOffsets[rightIndex] - rightCursorOffsets[leftIndex] < MinDistance) {
                        const increaseDistance = MinDistance - leftCursorOffsets[rightIndex] + rightCursorOffsets[leftIndex] - subtreeDistance;
                        if (leftIndex + 1 == rightIndex) {
                            thisnode.children[rightIndex].position += increaseDistance;
                        } else {
                            // ATTENTION only difference here, spread push apart distance to all intermediate subtrees
                            // e.g. push apart subtree 2 and subtree 4, increase distance 3, then subtree 3 + 1.5, subtree 4 + 1.5
                            for (let childIndex = leftIndex + 1; childIndex <= rightIndex; childIndex++) {
                                thisnode.children[childIndex].position += increaseDistance / (rightIndex - leftIndex);
                            }
                        }
                        log(`  push apart subtree[${leftIndex}] node #${thisnode.children[leftIndex].name} and subtree[${
                            rightIndex}] #${thisnode.children[rightIndex].name} increase distance ${round2(thisnode.children[rightIndex].position)}`);
                    }
                }
            }

            let leftmostChildIndex = activeIndexes[0];
            if (activeIndexes.length > 1 && !rightCursors[leftmostChildIndex]) {
                let subtreeDistance = 0;
                let nextLeftmostChildIndexIndex = 1;
                while (nextLeftmostChildIndexIndex < activeIndexes.length && !leftCursors[activeIndexes[nextLeftmostChildIndexIndex]]) {
                    subtreeDistance += thisnode.children[activeIndexes[nextLeftmostChildIndexIndex]].position;
                    nextLeftmostChildIndexIndex += 1;
                }
                if (nextLeftmostChildIndexIndex < activeIndexes.length) {
                    const nextLeftmostChildIndex = activeIndexes[nextLeftmostChildIndexIndex];
                    subtreeDistance += thisnode.children[nextLeftmostChildIndex].position;
                    log(`  thread from subtree[${leftmostChildIndex}] last left cursor #${leftCursors[leftmostChildIndex].name} to subtree[${
                        nextLeftmostChildIndex}] left cursor #${leftCursors[nextLeftmostChildIndex].name}, thread offset ${leftCursorOffsets[nextLeftmostChildIndex] - leftCursorOffsets[leftmostChildIndex] + subtreeDistance}`);
                    leftCursors[leftmostChildIndex].thread = leftCursors[nextLeftmostChildIndex];
                    leftCursors[leftmostChildIndex].threadOffset = leftCursorOffsets[nextLeftmostChildIndex] - leftCursorOffsets[leftmostChildIndex] + subtreeDistance;
                    leftmostChildIndex = nextLeftmostChildIndex;
                }
            }
            let rightmostChildIndex = activeIndexes[activeIndexes.length - 1];
            if (activeIndexes.length > 1 && !leftCursors[rightmostChildIndex]) {
                let subtreeDistance = thisnode.children[rightmostChildIndex].position;
                let nextRightmostChildIndexIndex = activeIndexes.length - 2;
                while (nextRightmostChildIndexIndex >= 0 && !rightCursors[activeIndexes[nextRightmostChildIndexIndex]]) {
                    subtreeDistance += thisnode.children[activeIndexes[nextRightmostChildIndexIndex]].position;
                    nextRightmostChildIndexIndex -= 1;
                }
                if (nextRightmostChildIndexIndex >= 0) {
                    const nextRightmostChildIndex = activeIndexes[nextRightmostChildIndexIndex];
                    log(`  thread from subtree[${rightmostChildIndex}] last right cursor #${rightCursors[rightmostChildIndex]
                        .name} to subtree[${nextRightmostChildIndex}] right cursor #${rightCursors[nextRightmostChildIndex].name}, thread offset ${
                            rightCursorOffsets[nextRightmostChildIndex] - rightCursorOffsets[rightmostChildIndex] - subtreeDistance}`);
                    rightCursors[rightmostChildIndex].thread = rightCursors[nextRightmostChildIndex];
                    rightCursors[rightmostChildIndex].threadOffset = rightCursorOffsets[nextRightmostChildIndex] - rightCursorOffsets[rightmostChildIndex] - subtreeDistance;
                    rightmostChildIndex = nextRightmostChildIndex;
                }
            }

            activeIndexes = newActiveIndexes;
            if (activeIndexes.length) {
                log(`  original leftmostDescendantPosition ${round2(leftmostDescendantPosition)} current leftmost node #${
                    leftCursors[leftmostChildIndex].name} position ${round2(leftCursorOffsets[leftmostChildIndex])}`);
                leftmostDescendantPosition = Math.min(leftmostDescendantPosition, leftCursorOffsets[leftmostChildIndex]);

                log(`  original rightmostNodes[${rightmostChildIndex}] #${rightmostNodes[rightmostChildIndex].node?.name ?? '()'},${
                    rightmostNodes[rightmostChildIndex].offset ?? ''}, current rightmost node #${rightCursors[rightmostChildIndex].name} offset ${rightCursorOffsets[rightmostChildIndex]}`);
                if (!rightmostNodes[rightmostChildIndex].node || rightmostNodes[rightmostChildIndex].offset < rightCursorOffsets[rightmostChildIndex]) {
                    rightmostNodes[rightmostChildIndex].node = rightCursors[rightmostChildIndex];
                    rightmostNodes[rightmostChildIndex].offset = rightCursorOffsets[rightmostChildIndex];
                }
            }

            loopCount += 1;
            if (loopCount > 20) { console.log('abort!'); process.exit(1); }
            log(`  end loop`);
        }

        let subtreeDistance = 0;
        let rightmostDescendantPosition = 0;
        for (const childIndex of childIndexSequence) {
            if (childIndex != 0) {
                subtreeDistance += thisnode.children[childIndex].position;
            }
            if (rightmostNodes[childIndex].node) {
                log(`  rightmost node in subtree[${childIndex}] is #${rightmostNodes[childIndex].node.name} offset (${subtreeDistance}) ${rightmostNodes[childIndex].offset}`);
                rightmostDescendantPosition = Math.max(rightmostDescendantPosition, subtreeDistance + rightmostNodes[childIndex].offset);
            }
        }
        let currentPosition = -(leftmostDescendantPosition + rightmostDescendantPosition) / 2;
        for (const child of thisnode.children) {
            currentPosition = child.position += currentPosition;
        }
        log(`  result child positions ${thisnode.children.map(c => `#${c.name}=${c.position}`).join(',')}`);
    }
    setup(root);

    log(`complete tree left contour`);
    let cursor = root;
    let cursorPosition = 0;
    let minCursorPosition = 0;
    while (true) {
        if (cursor.thread) {
            cursorPosition += cursor.threadOffset;
            cursor = cursor.thread;
            minCursorPosition = Math.min(minCursorPosition, cursorPosition);
        } else if (cursor.children.length) {
            cursor = cursor.children[0];
            cursorPosition += cursor.position;
            minCursorPosition = Math.min(minCursorPosition, cursorPosition);
        } else {
            break;
        }
        log(`  cursor #${cursor.name} position ${round2(cursorPosition)} minoffset ${round2(minCursorPosition)}`);
    }
    function setPosition(node: Node1, position: number) {
        node.position = position;
        node.thread = null;
        node.threadOffset = undefined;
        for (const child of node.children) {
            setPosition(child, position + child.position);
        }
    }
    setPosition(root, -minCursorPosition);
}

// by the way, record them if useful
// https://llimllib.github.io/pymag-trees/
// https://towardsdatascience.com/reingold-tilford-algorithm-explained-with-walkthrough-be5810e8ed93/
// https://github.com/zxch3n/tidy/blob/master/rust/crates/tidy-tree/src/layout/tidy_layout.rs and https://www.zxch3n.com/tidy/tidy/
// https://github.com/prefuse/Prefuse/blob/f62543210ad5b5e1ab656e0fbe3f54c2209d0cb7/src/prefuse/action/layout/graph/NodeLinkTreeLayout.java#L32

function testMinPositionIs0() {
    let T = 10000;
    while (T--) {
        const tree = generateTree(100);
        layout1(tree, {});
        let minPosition = 10000;
        function collectCoordinates(node: Node) {
            minPosition = Math.min(minPosition, node.position);
            for (const child of node.children) {
                collectCoordinates(child);
            }
        }
        collectCoordinates(tree);
        if (minPosition != 0) {
            console.log(`error, min position not 0: ${minPosition}`);
        }
    }
    console.log('completed 10000 tests');
}

const allcases: Node[] = JSON.parse(await fs
    .readFile('aesthetic/testcase.json', 'utf-8')).map((v: number[][]) => createTree(v.filter(r => typeof r != 'string')));
let tree: Node;
if (process.argv[2] == "testminpos") {
    testMinPositionIs0();
    process.exit(0);
} else if (process.argv[2]) {
    tree = allcases[+process.argv[2] - 1];
    if (!tree) {
        console.log(`invalid case id ${process.argv[2]}`);
        process.exit(1);
    }
} else {
    tree = generateTree();
}
const stat: { logs?: string[] } = {};
layout2(tree, stat);
await fs.writeFile('aesthetic/tidytree.log', stat.logs.join('\n'));
printTreeEdges(tree);
printTreePositions(tree);
prettyPrintTree(tree);

// CONCLUSION
// after read paper 3 and 4 and AI I've learned the issue they are talking,
// that small intermediate subtrees are stacked left side of available space between 2 large subtrees,
// paper 3 use strange, not same as paper 2, not time effecient code to fix the issue, which is very confusing,
// because my implementation layout1 is easy to account for this issue with very little change in push apart logic,
// while the paper 4 I obtained does not contain source code, I think read paper section is complete.
//
// the final implementation layout2 has pass all existing test cases, hundreds of random caseS and run successfully in hechen.html,
// so this subproject is GENERALLY COMPLETED.
