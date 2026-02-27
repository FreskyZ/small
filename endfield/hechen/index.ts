
interface ItemData {
    id: string,
    name: string, // name for human
    kind?: 'seed',
    desc: string[], // main desc and additional desc for human
}
interface MachineData {
    id: string,
    name: string, // name for human
    desc: string, // desc for human
    power: number,
}
interface RecipeData {
    id: string,
    name: string,
    kind?: 'pour',
    machineId: string,
    ingredients: { id: string, count: number }[],
    products: { id: string, count: number }[],
    time: number,
}

const elements = {
    itemsContainer: document.querySelector('nav ul') as HTMLUListElement,
    searchInput: document.querySelector('div#nav-header>input') as HTMLInputElement,
    main: document.querySelector('main'),
};

const pagedata = { ...(window as any)['EndfieldRecipes'], icons: (window as any)['EndfieldImages'] } as {
    items: ItemData[],
    machines: MachineData[],
    recipes: RecipeData[],
    icons: Record<string, string>,
};

function setupNavigationBar() {
    for (const item of pagedata.items) {
        const itemElement = document.createElement('li');
        itemElement.dataset['id'] = item.id;
        const imageElement = document.createElement('img');
        imageElement.alt = item.name;
        imageElement.title = item.name;
        imageElement.src = pagedata.icons[item.id];
        imageElement.width = 48;
        imageElement.height = 48;
        itemElement.appendChild(imageElement);
        const nameElement = document.createElement('div');
        nameElement.className = 'name';
        nameElement.innerText = item.name;
        itemElement.appendChild(nameElement);
        const descriptionElement = document.createElement('div');
        descriptionElement.className = 'description';
        descriptionElement.innerText = item.desc[0].replace('\n', '');
        descriptionElement.title = item.desc[0] + item.desc[1];
        itemElement.appendChild(descriptionElement);
        elements.itemsContainer.appendChild(itemElement);
        // TODO active all opened items?
        itemElement.addEventListener('click', () => handleItemClick(item));
    }

    // search
    elements.searchInput.addEventListener('change', () => {
        for (const itemElement of Array.from<HTMLLIElement>(elements.itemsContainer.children as any)) {
            if (!elements.searchInput.value) {
                itemElement.style.display = 'grid';
            } else {
                const item = pagedata.items.find(i => i.id == itemElement.dataset['id']);
                itemElement.style.display = item.name.includes(elements.searchInput.value) ? 'grid' : 'none';
            }
        }
    });
}
setupNavigationBar();

// layout algorithm only need these
interface NodeLike {
    children: NodeLike[],
    position?: number,
    thread?: NodeLike,
    threadOffset?: number,
}
interface ItemNode extends NodeLike {
    // id, name, desc[0], desc[1], data.icons[id]
    data: ItemData,
    // depth is x coordinate
    depth: number,
    // is duplicate node on the path, display an ellipsis for children
    duplicate: boolean,
    children: RecipeNode[],
    possibleProducts: ItemData[],
}
interface RecipeNode extends NodeLike {
    // id, name, machineId, time, ingredients, products
    data: RecipeData,
    // depth is x coordinate
    depth: number,
    // use node[] here should make tree operations easier
    // when need to display count, find them in node.data.ingredients
    children: ItemNode[],
}

// for duplicate item in tree, allow same item appear in different line, disallow same item in same line
// path: node id[] from root to current item, include root, not include current item, empty for the main item
// return ItemNode
function collectRecipeTree(item: ItemData, path: string[]) {
    const itemNode: ItemNode = { data: item, depth: path.length, duplicate: false, children: [], possibleProducts: [] };
    if (path.includes(item.id)) {
        itemNode.duplicate = true;
        return itemNode;
    }
    if (!path.length) {
        const possibleProductIds = pagedata.recipes.filter(r => r.ingredients.some(r => r.id == item.id)).flatMap(r => r.products.map(r => r.id));
        itemNode.possibleProducts = Array.from(new Set(possibleProductIds)).map(id => pagedata.items.find(i => i.id == id));
    }
    if (path.length > 10) {
        throw new Error('unexpected too deep');
    }
    // regard seed as leaf node, no recipe
    if (item.kind != 'seed') {
        // exclude pour in normal dependency tree (allow in possible products)
        for (const recipe of pagedata.recipes.filter(r => r.kind != 'pour' && r.products.some(r => r.id == item.id))) {
            itemNode.children.push({
                data: recipe,
                // feel free to duplicate depth, the layout algorithm completely don't use node.depth and even node name
                depth: path.length,
                children: recipe.ingredients.map(ingredient => collectRecipeTree(pagedata.items.find(i => i.id == ingredient.id), [...path, item.id])),
            });
        }
    }
    return itemNode;
}

function layoutRecipeTree(tree: NodeLike) {
    // position in this layout algorithm represents 1 unit in render operation, this min distance must be 1
    const MinDistance = 1;
    function setup(thisnode: NodeLike) {
        for (const child of thisnode.children.filter(c => c.children.length)) { setup(child); }
        if (thisnode.children.length == 1) { thisnode.children[0].position = 0; return; }

        const childCount = thisnode.children.length;
        const childIndexSequence = new Array(childCount).fill(0).map((_, i) => i);
        childIndexSequence.forEach(childIndex => thisnode.children[childIndex].position = childIndex == 0 ? 0 : MinDistance);

        let activeIndexes = childIndexSequence.map(i => i);
        const leftCursors = thisnode.children.map(n => n);
        const leftCursorOffsets = thisnode.children.map(() => 0);
        const rightCursors = thisnode.children.map(n => n);
        const rightCursorOffsets = thisnode.children.map(() => 0);

        let leftmostDescendantPosition = 0;
        let rightmostNodes = childIndexSequence.map(childIndex =>
            childIndex == childCount - 1 ? { node: thisnode.children[childIndex], offset: 0 } : { node: null, offset: undefined });

        while (activeIndexes.length) {

            for (const childIndex of activeIndexes) {
                if (leftCursors[childIndex].thread) {
                    leftCursorOffsets[childIndex] += leftCursors[childIndex].threadOffset;
                    leftCursors[childIndex] = leftCursors[childIndex].thread;
                } else if (leftCursors[childIndex].children.length) {
                    leftCursors[childIndex] = leftCursors[childIndex].children[0];
                    leftCursorOffsets[childIndex] += leftCursors[childIndex].position;
                } else if (childIndex != activeIndexes[0] || activeIndexes.length == 1) {
                    leftCursors[childIndex] = null;
                }

                if (rightCursors[childIndex].thread) {
                    rightCursorOffsets[childIndex] += rightCursors[childIndex].threadOffset;
                    rightCursors[childIndex] = rightCursors[childIndex].thread;
                } else if (rightCursors[childIndex].children.length) {
                    rightCursors[childIndex] = rightCursors[childIndex].children[rightCursors[childIndex].children.length - 1];
                    rightCursorOffsets[childIndex] += rightCursors[childIndex].position;
                } else if (childIndex != activeIndexes[activeIndexes.length - 1] || activeIndexes.length == 1) {
                    rightCursors[childIndex] = null;
                }
            }

            const newActiveIndexes = activeIndexes.filter((childIndex, i) => i == 0 ? rightCursors[childIndex] : leftCursors[childIndex]);
            if (newActiveIndexes.length > 1) {
                for (const [leftIndex, rightIndex] of new Array(newActiveIndexes.length - 1)
                    .fill(0).map((_, i) => [newActiveIndexes[i], newActiveIndexes[i + 1]]))
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
                            for (let childIndex = leftIndex + 1; childIndex <= rightIndex; childIndex++) {
                                thisnode.children[childIndex].position += increaseDistance / (rightIndex - leftIndex);
                            }
                        }
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
                    rightCursors[rightmostChildIndex].thread = rightCursors[nextRightmostChildIndex];
                    rightCursors[rightmostChildIndex].threadOffset = rightCursorOffsets[nextRightmostChildIndex] - rightCursorOffsets[rightmostChildIndex] - subtreeDistance;
                    rightmostChildIndex = nextRightmostChildIndex;
                }
            }

            activeIndexes = newActiveIndexes;
            if (activeIndexes.length) {
                leftmostDescendantPosition = Math.min(leftmostDescendantPosition, leftCursorOffsets[leftmostChildIndex]);
                if (!rightmostNodes[rightmostChildIndex].node || rightmostNodes[rightmostChildIndex].offset < rightCursorOffsets[rightmostChildIndex]) {
                    rightmostNodes[rightmostChildIndex].node = rightCursors[rightmostChildIndex];
                    rightmostNodes[rightmostChildIndex].offset = rightCursorOffsets[rightmostChildIndex];
                }
            }
        } // this is end of the main loop if you lost track

        let subtreeDistance = 0;
        let rightmostDescendantPosition = 0;
        for (const childIndex of childIndexSequence) {
            if (childIndex != 0) {
                subtreeDistance += thisnode.children[childIndex].position;
            }
            if (rightmostNodes[childIndex].node) {
                rightmostDescendantPosition = Math.max(rightmostDescendantPosition, subtreeDistance + rightmostNodes[childIndex].offset);
            }
        }

        let currentPosition = -(leftmostDescendantPosition + rightmostDescendantPosition) / 2;
        for (const child of thisnode.children) {
            currentPosition = child.position += currentPosition;
        }
    }
    setup(tree);

    let cursor = tree;
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
    }
    function setPosition(node: NodeLike, position: number) {
        node.position = position;
        node.thread = null;
        node.threadOffset = undefined;
        for (const child of node.children) {
            setPosition(child, position + child.position);
        }
    }
    setPosition(tree, -minCursorPosition);
}

// this name inherits from jsx?
// TODO see whether parent and additionalOperations parameters works ok
function j<K extends keyof HTMLElementTagNameMap>(parent: Element, tag: K, props: {
    className?: string,
    dataset?: Record<string, string>,
    style?: Partial<CSSStyleDeclaration>,
    // frequently used style, add a special props to make them simpler
    left?: number, top?: number, width?: number, height?: number,
    innerText?: string,
}, additionalOperations?: (e: HTMLElementTagNameMap[K]) => void): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (props?.className) { element.className = props.className; }
    if (props?.dataset) { Object.assign(element.dataset, props.dataset); }
    if (props?.style) { Object.assign(element.style, props.style); }
    if (props?.left) { element.style.left = `${props.left}px`; }
    if (props?.top) { element.style.top = `${props.top}px`; }
    if (props?.width) { element.style.width = `${props.width}px`; }
    if (props?.height) { element.style.height = `${props.height}px`; }
    if (props?.innerText) { element.innerText = props.innerText; }
    if (additionalOperations) { additionalOperations(element); }
    parent.appendChild(element);
    return element;
}

// and delete icon (trash icon?)
const Clock = [
    "M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372z",
    "M686.7 638.6L544.1 535.5V288c0-4.4-3.6-8-8-8H488c-4.4 0-8 3.6-8 8v275.4c0 2.6 1.2 5 3.3 6.5l165.4 120.6c3.6 2.6 8.6 1.8 11.2-1.7l28.6-39c2.6-3.7 1.8-8.7-1.8-11.2z",
];
const Thunderbolt = ["M848 359.3H627.7L825.8 109c4.1-5.3.4-13-6.3-13H436c-2.8 0-5.5 1.5-6.9 4L170 547.5c-3.1 5.3.7 12 6.9 12h174.4l-89.4 " +
    "357.6c-1.9 7.8 7.5 13.3 13.3 7.7L853.5 373c5.2-4.9 1.7-13.7-5.5-13.7zM378.2 732.5l60.3-241H281.1l189.6-327.4h224.6L487 427.4h211L378.2 732.5z"];

function createSVGElement(parent: Element, pathdata: string[], className?: string) {
    const svgns = 'http://www.w3.org/2000/svg';
    const svgElement = document.createElementNS(svgns, 'svg');
    svgElement.setAttribute('viewBox', '64 64 896 896');
    svgElement.setAttribute('fill', 'currentColor');
    if (className) { svgElement.setAttribute('class', className); }
    for (const data of pathdata) {
        const pathElement = document.createElementNS(svgns, 'path');
        pathElement.setAttribute('d', data);
        svgElement.appendChild(pathElement);
    }
    parent.appendChild(svgElement);
    return svgElement;
}

function drawRecipeTree(tree: ItemNode) {

    // you can go down boundaries of the tree for this information,
    // but I'd like to avoid layout algorithm internals outside, so visit all nodes
    let maxDepth = 0;
    let maxPosition = -100;
    function collectCoordinates(node: ItemNode | RecipeNode) {
        maxDepth = Math.max(maxDepth, node.depth);
        maxPosition = Math.max(maxPosition, node.position);
        for (const child of node.children) {
            collectCoordinates(child);
        }
    }
    collectCoordinates(tree);

    // position: unit of position, as in node.position and node.depth,
    //           one item *or* one recipe occupy 1 unit of height, one item *and* one recipe occupy 1 unit of width
    // standardize calculation:
    //   - panel left padding 32px, top padding 40px,
    //     that is main visual element (item's img and recipe's machine name) leftmost and topmost position,
    //   - item occupies full height 72px, so item.position = 0 starts at top: 40px
    //   - item with .depth = maxdepth's img should be at left 32px, and item's grid: 8px 48px 24px, so item-node's left: 24px
    //   - amount container and right arrow line use 24px, collect line use 8px, left arrow line use 8px,
    //     so visual gap (gap between item img and recipe machine name) is 40px
    //     // if you try to implement no collect-line use 32px or 24px, that's endless calculation (not actually, O(n2) I guess)
    //   - item width .depth = maxdepth's img ends at 80px, so recipe with .depth = maxdepth - 1's machine name starts at 120px
    //     recipe's grid 8px 68px 24px, so recipe with .depth = maxdepth - 1 start at left: 112px, ends at left 188px
    //     add same visual gap 40px, item with .depth = maxdepth - 1's img starts at left 228px, which means item-node starts at 220px
    //     so grid width is 196px
    //   - machine name height 24px, should be centered at item img if they have same .position
    //     so recipe with .position = 0 starts at top: 52px
    //   - if no possible products, final item with .depth = 0 have a right padding 32px
    //     final item's starts at maxdepth * gridwidth + 24px, so img ends at maxdepth + gridwidth + 80px, panel width is maxdepth * gridwidth + 112px
    //     if have possible products, add final item and possible products gap 40px, and possible product img width 48px, which is total add 88px
    //   - if no possible products, item with .position = maxposition have top: maxposition * gridheight + 40px
    //     between panel height and item's text (attention not img) should be 32px padding bottom, so panel height is (maxposition + 1) * gridheight + 40 + 32
    //     if have possible products and count > maxposition, every item occupy gridheight height, plus 40 padding top and 32 padding bottom
    const GridWidth = 196;
    const GridHeight = 72;

    const panelElement = j(elements.main, 'div', {
        className: 'panel',
        dataset: { 'id': tree.data.id },
        left: 100,
        top: 100,
        // UPDATE: add 16 if possible product because it's grid size increases
        width: GridWidth * maxDepth + (tree.possibleProducts.length ? 216 : 112), 
        height: GridHeight * (Math.max(maxPosition + 1, tree.possibleProducts.length)) + 72,
    }, element => {
        // drag move panel element
        // TODO consider only title use cursor:grab, but still can click anywhere to start drag
        let beginX = 0;
        let beginY = 0;
        element.addEventListener('mousedown', e => {
            focusPanel(tree.data.id);
            if ((e.target as any).matches('input')) {
                return; // do not drag input
            }
            e.preventDefault();
            beginX = e.clientX;
            beginY = e.clientY;
            element.style.cursor = 'grabbing';
            element.addEventListener('mouseup', handleMouseUp);
            element.addEventListener('mousemove', handleMouseMove);
            function handleMouseMove(e: MouseEvent) {
                e.preventDefault();
                element.style.left = (element.offsetLeft - beginX + e.clientX) + 'px';
                element.style.top = (element.offsetTop - beginY + e.clientY) + 'px';
                beginX = e.clientX;
                beginY = e.clientY;
            }
            function handleMouseUp(_: MouseEvent) {
                element.style.cursor = 'grab';
                element.removeEventListener('mouseup', handleMouseUp);
                element.removeEventListener('mousemove', handleMouseMove);
            }
        });
    });
    /* close */ j(panelElement, 'button', { className: 'close', innerText: 'X' }, e => e.addEventListener('click', () => panelElement.remove()));
    /* title */ j(panelElement, 'span', { className: 'title', innerText: tree.data.name });

    // TODO speed requirement
    // speed in calculation is always item per second, note that user input per time speed is item per minute, not per second
    const speedPerMachine0 = tree.children.length == 1 ? tree.children[0].data.products.find(i => i.id == tree.data.id).count / tree.children[0].data.time : 1;
    // starts with 1 machine if only 1 recipe, or 30 per minute (1 belt)
    const initSpeed = tree.children.length == 1 ? speedPerMachine0 : 0.5;
    const speedHandlers: ((newSpeed: number) => void)[] = [];
    const speedContainer = j(panelElement, 'span', { className: 'speed-container' });
    if (tree.children.length) {
        if (tree.children.length == 1) {
            /* machine count requirement */ j(speedContainer, 'input', {}, e => {
                e.type = 'number';
                e.name = 'machine-count-requirement';
                e.value = (Math.round(initSpeed / speedPerMachine0 * 100) / 100).toString();
                e.addEventListener('change', () => {
                    const newMachineCount = +e.value;
                    // ignore invalid value and 0
                    if (newMachineCount) { for (const handler of speedHandlers) { handler(newMachineCount * speedPerMachine0); } }
                });
                speedHandlers.push(newSpeed => e.value = (Math.round(newSpeed / speedPerMachine0 * 100) / 100).toString());
            });
            /* speed label */ j(speedContainer, 'label', { innerText: '个机器或' }, e => e.htmlFor = 'machine-count-requirement');
        }
        /* item count requirement */ j(speedContainer, 'input', {}, e => {
            e.type = 'number';
            e.name = 'item-count-requirement';
            e.value = (Math.round(initSpeed * 60 * 100) / 100).toString();
            e.addEventListener('change', () => {
                const newPerMinute = +e.value;
                // ignore invalid value and 0
                if (newPerMinute) { for (const handler of speedHandlers) { handler(newPerMinute / 60); } }
            });
            speedHandlers.push(newSpeed => e.value = (Math.round(newSpeed * 60 * 100) / 100).toString());
        });
        /* speed label */ j(speedContainer, 'label', { innerText: '个每分钟' }, e => e.htmlFor = 'item-count-requirement');
        // TODO reset icon to set speed to initial
    }
    // TODO machine count and power report as in "100个机器1000W电" .title = "50个粉碎机10个精炼炉"

    function isItemNode(node: ItemNode | RecipeNode): node is ItemNode {
        return node.data.id.startsWith('item_');
    }
    function createNode(node: ItemNode | RecipeNode, parent: ItemNode | RecipeNode) {
        // TODO consider allow collapse an item node
        if (isItemNode(node)) {
            const item = node;
            const itemElement = j(panelElement, 'div', {
                className: 'item-node' + (item.data.id == tree.data.id ? ' main-item-node' : ''),
                dataset: { 'kind': 'item', 'id': item.data.id },
                left: GridWidth * (maxDepth - item.depth) + 24,
                top: GridHeight * item.position + 40,
            }, e => {
                if (item.data.id != tree.data.id) {
                    e.style.cursor = 'pointer';
                    e.addEventListener('click', () => handleItemClick(item.data));
                }
            });
            /* item image */ j(itemElement, 'img', {}, e => {
                e.alt = item.data.name;
                e.src = pagedata.icons[item.data.id];
                e.width = 40;
                e.height = 40;
            });
            // now item-node width 80px cannot fit "bottle with liquid" names, try add a span and make it wider
            const nameContainer = j(itemElement, 'div', { className: 'name' });
            /* name */ j(nameContainer, 'span', { innerText: item.data.name }, e => e.title = item.data.desc[0]);
            if (item.children.length) {
                // TODO antd arrwoline icon looks not good
                // /* arrow line */ createSVGElement(itemElement, ArrowLine, 'arrow-line');
                /* arrow line */ j(itemElement, 'div', { className: 'arrow-line' });
            } else if (item.duplicate) {
                /* ellipsis */ j(itemElement, 'div', { className: 'ellipsis' }, e => e.title = '之前在链路上出现过了');
            }

            if (parent && !isItemNode(parent)) {
                // TODO recipe amount seems can be put inside item img, and put calculated speed requirement at this amount location
                const amount = parent.data.ingredients.find(i => i.id == item.data.id).count;
                // TODO seems need to calculate based on final requirement, so empty them for now
                const perSecond = ''; // `${Math.round(amount / parent.data.time * 10) / 10}/s`;
                const beltPerSecond = ''; // `${Math.round(amount / parent.data.time / 0.5 * 10) / 10}带`;
                /* amount */ j(itemElement, 'span', { className: 'amount', innerText: `×${amount}` });
                /* amount ps */ j(itemElement, 'span', { className: 'amount-ps', innerText: perSecond });
                /* amount bps */ j(itemElement, 'span', { className: 'amount-bps', innerText: beltPerSecond });
                // only one amount element for now, need a arrow line at right
                // TODO change left arrow line and right arrow line to both width 16, rename arrow line because it does not have arrow, may be connect-line?
                /* arrow line */ j(itemElement, 'div', { className: 'arrow-line-right' });
            }
            for (const recipe of item.children) {
                // collect line belong to panel element, not item element
                /* collect line */ j(panelElement, 'div', {
                    // -no: no up and no down
                    className: 'collect-line ' + (item.position > recipe.position
                        ? 'collect-line-down' : item.position == recipe.position ? 'collect-line-no' : 'collect-line-up'),
                    dataset: { 'item': item.data.id, 'recipe': recipe.data.id },
                    // item-node.left - collect-line.width
                    left: GridWidth * (maxDepth - item.depth) + 16,
                    // if follow item, item-node.top + 24, if follow recipe, recipe-node.top + 12, both are add 64
                    // why does visual inspection shows 66 is correct?
                    top: item.position < recipe.position ? GridHeight * item.position + 66 : GridHeight * recipe.position + 66,
                    height: GridHeight * Math.abs(recipe.position - item.position),
                });
            }
            if (item.possibleProducts.length) {
                // this right arrow line is same as if have parent's right arrow line
                /* arrow line right */ j(itemElement, 'div', { className: 'arrow-line-right arrow-line-right-dotted' });
                // if products length < maxposition + 1 (+1 because maxposition starts at 0), then products should be centered around root node's position
                //   if length == 1, baseposition should be same as root item position, if length == 2, baseposition should be root item position -0.5
                // else products should tightly fit in complete height of the panel
                const basePosition = item.possibleProducts.length < maxPosition + 1 ? tree.position - (item.possibleProducts.length - 1) / 2 : 0;
                // TODO this issue also happens in normal item node
                // 什么叫 possible product 名字太长了和 spread-line 撞上了, so make left arrow line width 24
                for (const [product, productIndex] of item.possibleProducts.map((p, i) => [p, i] as const)) {
                    const productPosition = basePosition + productIndex;
                    const productElement = j(panelElement, 'div', {
                        className: 'product-node',
                        dataset: { 'id': product.id },
                        // same visual gap between root item and possible product item,
                        // so this left is same as recipe position with depth = -1
                        left: GridWidth * maxDepth + 112,
                        // same as item-node regarding productPosition as item.position
                        top: GridHeight * productPosition + 40,
                    }, e => e.addEventListener('click', () => handleItemClick(product)));
                    /* product image */ j(productElement, 'img', {}, e => {
                        e.alt = product.name;
                        e.src = pagedata.icons[product.id];
                        e.width = 40;
                        e.height = 40;
                    });
                    const nameContainer = j(productElement, 'div', { className: 'name' });
                    /* name */ j(nameContainer, 'span', { innerText: product.name }, e => e.title = product.desc[0]);
                    /* arrow line */ j(productElement, 'div', { className: 'arrow-line' });
                    
                    /* collect line */ j(panelElement, 'div', {
                        // spread line: opposite of collect line
                        className: 'spread-line ' + (item.position > productPosition
                            ? 'spread-line-down' : item.position == productPosition ? 'spread-line-no' : 'spread-line-up'),
                        dataset: { 'item': item.data.id, 'product': product.id },
                        // product-node.left - 8
                        left: GridWidth * maxDepth + 104,
                        // if follow item, item-node.top + 24, if follow product, product-node.top + 24, both are add 64
                        // why does visual inspection shows 66 is correct?
                        top: item.position < productPosition ? GridHeight * item.position + 66 : GridHeight * productPosition + 66,
                        height: GridHeight * Math.abs(productPosition - item.position),
                    });
                }
            }
        } else {
            const recipe = node;
            const recipeElement = j(panelElement, 'div', {
                className: 'recipe-node',
                dataset: { 'id': recipe.data.id },
                left: GridWidth * (maxDepth - recipe.depth - 1) + 112,
                top: GridHeight * recipe.position + 52,
            });
            /* arrow line */ j(recipeElement, 'div', { className: 'arrow-line' });
            const machine = pagedata.machines.find(m => m.id == recipe.data.machineId);
            /* machine name */ j(recipeElement, 'div', { className: 'machine-name', innerText: machine.name });
            // TODO change to top info and bottom info, top info time and amount, bottom info power and machine size
            const infoElement = j(recipeElement, 'div', { className: 'info-container' });
            /* time icon */ createSVGElement(infoElement, Clock, 'time-icon');
            /* time */ j(infoElement, 'span', { className: 'time', innerText: `${recipe.data.time}s` });
            /* power icon */ createSVGElement(infoElement, Thunderbolt, 'power-icon');
            /* power */ j(infoElement, 'span', { className: 'power', innerText: `${machine.power}W` });
            const amount = recipe.data.products.find(p => p.id == parent.data.id).count;
            /* amount */ j(recipeElement, 'span', { className: 'amount', innerText: `×${amount}` });
            /* arrow line right */ j(recipeElement, 'div', { className: 'arrow-line-right' });
            for (const item of recipe.children) {
                // collect line belong to panel element, not recipe element
                /* collect line */ j(panelElement, 'div', {
                    className: 'collect-line ' + (recipe.position > item.position
                        ? 'collect-line-down' : recipe.position == item.position ? 'collect-line-no' : 'collect-line-up'),
                    dataset: { 'item': item.data.id, 'recipe': recipe.data.id },
                    // recipe-node.left - 8
                    left: GridWidth * (maxDepth - recipe.depth - 1) + 104,
                    // if follow recipe, recipe-node.top + 12, if follow item, item-node.top + 24, both are add 64
                    // why does visual inspection shows 66 is correct?
                    top: GridHeight * (recipe.position > item.position ? item.position : recipe.position) + 66,
                    height: Math.abs(item.position - recipe.position) * GridHeight,
                });
            }
        }
        for (const child of node.children) {
            createNode(child, node);
        }
    }
    createNode(tree, null);
}

function focusPanel(itemId: string) {
    const panels: HTMLDivElement[] = Array.from(elements.main.querySelectorAll('div.panel'));
    const getZIndex = (e: HTMLDivElement) => e.dataset['id'] == itemId ? 1000 : +(e.style.zIndex ?? '0');
    panels.sort((e1, e2) => getZIndex(e1) - getZIndex(e2));
    for (const [panel, panelIndex] of panels.map((p, i) => [p, i] as const)) {
        panel.style.zIndex = (panelIndex + 1).toString();
    }
}
function handleItemClick(item: ItemData) {
    // TODO consider make <main> scroll zoom, make main look like drag move that actually moves all panels
    // TODO add a dropdown menu displaying all opened panels and allow center and close, also a clear button
    // TODO clear all button
    // TODO speed requirement radio group: per second, per minute, belt count
    const panels: HTMLDivElement[] = Array.from(elements.main.querySelectorAll('div.panel'));
    const existPanel = panels.find(p => p.dataset['id'] == item.id);
    if (existPanel) {
        focusPanel(item.id);
    } else {
        const tree = collectRecipeTree(item, []);
        layoutRecipeTree(tree);
        drawRecipeTree(tree);
        focusPanel(tree.data.id);
    }
}
