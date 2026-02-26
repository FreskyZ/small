
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

// elements:
// - item icon, name, left side line/left side dash line, right side line and ingrediant count text: .item-node
// - recipe machine name, time and clock icon, "have other product" icon: .recipe-node
// - possible product, "need other ingredient" icon, its left side line: .product-node
// - the curved line collecting all recipes of an item and all ingredients of a recipe: .collect-line
// - regard item and its recipe use same depth (Math.floor(node.depth / 2)), each cell width 180px, height 72px
//   ecah cell start with recipe's left side line and then recipe machine name, item's collect line, item's left side line, item's right side line and count text,
//   item image horizontal align right and vertical align middle in one cell, recipe machine name horizontal align left in one cell
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

    const GridWidth = 180;
    const GridHeight = 72;
    function createPanel() {
        const panelElement = j(elements.main, 'div', {
            className: 'recipe-panel',
            left: 100,
            top: 100,
            width: (tree.possibleProducts.length ? 40 : -40) + (maxDepth + 1) * GridWidth, 
            height: (Math.max(maxPosition + 2, tree.possibleProducts.length + 1)) * GridHeight,
        }, element => {
            // drag move panel element
            // TODO only title use cursor:grab, but still can click anywhere to start drag
            let beginX = 0;
            let beginY = 0;
            element.addEventListener('mousedown', e => {
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
        /* close button */ j(panelElement, 'button', { className: 'close', innerText: 'X' }, e => e.addEventListener('click', () => panelElement.remove()));
        /* title */ j(panelElement, 'div', { className: 'title', innerText: tree.data.name });
        return panelElement;
    }
    // TODO make <main> scroll zoom, make main look like drag move that actually moves all panels
    // TODO manage focus and z-index of panels, don't duplicate create panels
    // TODO add a dropdown menu displaying all opened panels and allow center and close, also a clear button
    const panelElement = createPanel();

    function isItemNode(node: ItemNode | RecipeNode): node is ItemNode {
        return node.data.id.startsWith('item_');
    }
    function displayNode(node: ItemNode | RecipeNode, parent: ItemNode | RecipeNode) {
        // TODO allow collapse an item node
        if (isItemNode(node)) {
            const item = node;
            const itemElement = j(panelElement, 'div', {
                // TODO highlight main item because it may be shadowed by possible products
                className: 'item-node' + (item.data.id == tree.data.id ? ' main-item-node' : ''),
                dataset: { 'kind': 'item', 'id': item.data.id },
                left: 32 + (maxDepth - item.depth) * GridWidth,
                top: 40 + item.position * GridHeight,
            });
            /* item image */ j(itemElement, 'img', {}, e => {
                e.alt = item.data.name;
                e.src = pagedata.icons[item.data.id];
                e.width = 40;
                e.height = 40;
            });
            // TODO widen node item to allow item name display in one line
            /* name */ j(itemElement, 'div', { className: 'name', innerText: item.data.name }, e => e.title = item.data.desc[0]);
            // TODO if node.duplicate, display a dashed line
            /* arrow line */ j(itemElement, 'div', { className: item.duplicate ? 'dash-line' : 'arrow-line' });

            if (parent && !isItemNode(parent)) {
                const count = parent.data.ingredients.find(i => i.id == item.data.id).count;
                const perSecond = `${Math.round(count / parent.data.time * 10) / 10}/s`;
                const beltPerSecond = `${Math.round(count / parent.data.time / 0.5 * 10) / 10}带`;
                /* count line */ j(itemElement, 'div', {
                    className: 'count-line',
                    dataset: { 'item': item.data.id, 'recipe': parent.data.id },
                    left: (maxDepth - node.depth + 1) * GridWidth,
                    top: 52 + node.position * GridHeight,
                    // TODO move to css
                    width: 16,
                    height: 12,
                    // TODO text at down side of line if this line goes up (by use border-up instead of border-bottom)
                    innerText: `×${count}\n${perSecond}\n${beltPerSecond}`,
                });
            }
            for (const recipe of item.children) {
                // collect line belong to panel element, not item element
                /* item collect line */ j(panelElement, 'div', {
                    className: 'collect-line ' + (item.position > recipe.position ? 'collect-line-down' : 'collect-line-up'),
                    dataset: { 'item': item.data.id, 'recipe': recipe.data.id },
                    left: 48 + 40 + (maxDepth - item.depth - 1) * GridWidth,
                    top: 64 + (item.position > recipe.position ? recipe.position : item.position) * GridHeight,
                    width: 12, // TODO move to css
                    height: Math.abs(recipe.position - item.position) * GridHeight,
                });
            }
            // TODO possible products are connected with dash line, not solid line
            if (item.possibleProducts.length) {
                /* TODO possible product side's arrow-line */
                /* TODO possible product spread line (opposite of collect-line) */
                // position in units, not px
                const basePosition = (maxPosition - item.possibleProducts.length) / 2;
                for (const [product, productIndex] of item.possibleProducts.map((p, i) => [p, i] as const)) {
                    // TODO handleclick
                    const productElement = j(panelElement, 'div', {
                        className: 'product-node',
                        dataset: { 'id': product.id },
                        left: 40 + (maxDepth - node.depth + 1) * GridWidth,
                        top: (basePosition + productIndex + 1) * GridHeight,
                    }, e => e.addEventListener('click', () => handleItemClick(product)));
                    /* product image */ j(productElement, 'img', {}, e => {
                        e.alt = item.data.name;
                        e.src = pagedata.icons[item.data.id];
                        e.width = 40;
                        e.height = 40;
                    });
                    /* product name */ j(productElement, 'div', { className: 'name', innerText: product.name }, e => e.title = product.desc[0]);
                }
            }
        } else {
            const recipe = node;
            const recipeElement = j(panelElement, 'div', {
                className: 'recipe-node',
                dataset: { 'id': recipe.data.id },
                left: 112 + (maxDepth - recipe.depth - 1) * GridWidth,
                top: 52 + recipe.position * GridHeight,
            });
            // TODO 装备原件机 unexpected wrapped
            const machine = pagedata.machines.find(m => m.id == recipe.data.machineId);
            /* machine name */ j(recipeElement, 'div',
                { className: 'machine-name', innerText: machine.name }, e => e.title = `${machine.power}W, ${machine.desc}`);
            /* time */ j(recipeElement, 'div', { className: 'time', innerText: `${recipe.data.time}s` });
            /* arrow line */ j(recipeElement, 'div', { className: 'arrow-line' });
            for (const item of recipe.children) {
                // collect line belong to panel element, not recipe element
                /* item collect line */ j(panelElement, 'div', {
                    className: 'collect-line ' + (item.position > recipe.position ? 'collect-line-down' : 'collect-line-up'),
                    dataset: { 'item': item.data.id, 'recipe': recipe.data.id },
                    left: 96 + (maxDepth - recipe.depth - 1) * GridWidth,
                    top: 60 + 4 + (recipe.position > item.position ? item.position : recipe.position) * GridHeight,
                    width: 8, // TODO move to css
                    height: Math.abs(item.position - recipe.position) * GridHeight,
                });
            }
        }
        for (const child of node.children) {
            displayNode(child, node);
        }
    }
    displayNode(tree, null);
}

function handleItemClick(item: ItemData) {
    const tree = collectRecipeTree(item, []);
    layoutRecipeTree(tree);
    drawRecipeTree(tree);
}
