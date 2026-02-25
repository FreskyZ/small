
interface ItemData {
    id: string,
    name: string, // name for human
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
    machineId: string,
    ingredients: { id: string, count: number }[],
    products: { id: string, count: number }[],
    time: number,
}

const imagedata = window['EndfieldImages'] as Record<string, string>;
const recipedata = window['EndfieldRecipes'] as {
    items: ItemData[],
    machines: MachineData[],
    recipes: RecipeData[],
};

const elements = {
    itemsContainer: document.querySelector('nav ul') as HTMLUListElement,
    searchInput: document.querySelector('div#nav-header>input') as HTMLInputElement,
    recipeContainer: document.querySelector('div#recipe-container') as HTMLDivElement,
};

for (const item of recipedata.items.sort((a, b) => a.id.localeCompare(b.id))) {
    const itemElement = document.createElement('li');
    itemElement.dataset.id = item.id;
    itemElement.addEventListener('click', () => handleListItemClick(item));
    const imageElement = document.createElement('img');
    imageElement.alt = item.name;
    imageElement.title = item.name;
    imageElement.src = imagedata[item.id];
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
}

// search
elements.searchInput.addEventListener('change', () => {
    for (const itemElement of Array.from<HTMLLIElement>(elements.itemsContainer.children as any)) {
        if (!elements.searchInput.value) {
            itemElement.style.display = 'grid';
        } else {
            const item = recipedata.items.find(i => i.id == itemElement.dataset.id);
            itemElement.style.display = item.name.includes(elements.searchInput.value) ? 'grid' : 'none';
        }
    }
});

// drag move recipe container
let recipeContainerBeginMoveX = 0;
let recipeContainerBeginMoveY = 0;
elements.recipeContainer.addEventListener('mousedown', e => {
    e.preventDefault();
    recipeContainerBeginMoveX = e.clientX;
    recipeContainerBeginMoveY = e.clientY;
    elements.recipeContainer.style.cursor = 'grabbing';
    elements.recipeContainer.addEventListener('mouseup', handleMouseUp);
    elements.recipeContainer.addEventListener('mousemove', handleMouseMove);
    function handleMouseMove(e: MouseEvent) {
        e.preventDefault();
        elements.recipeContainer.style.left = (elements.recipeContainer.offsetLeft - recipeContainerBeginMoveX + e.clientX) + 'px';
        elements.recipeContainer.style.top = (elements.recipeContainer.offsetTop - recipeContainerBeginMoveY + e.clientY) + 'px';
        recipeContainerBeginMoveX = e.clientX;
        recipeContainerBeginMoveY = e.clientY;
    }
    function handleMouseUp(_: MouseEvent) {
        elements.recipeContainer.style.cursor = 'grab';
        elements.recipeContainer.removeEventListener('mouseup', handleMouseUp);
        elements.recipeContainer.removeEventListener('mousemove', handleMouseMove);
    }
});

// don't include pour liquid in left part of recipe tree
const allRecipesExceptPour = recipedata.recipes.filter(r => !(r.machineId == 'dismantler_1'
    && r.products.length == 2 && r.products.some(p => p.id.includes('bottle')) && r.products.some(p => p.id.includes('liquid'))));

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
    const itemNode: ItemNode = { data: item, depth: 2 * path.length, duplicate: false, children: [], possibleProducts: [] };
    if (path.includes(item.id)) {
        itemNode.duplicate = true;
        return itemNode;
    }
    if (!path.length) {
        const possibleProductIds = recipedata.recipes.filter(r => r.ingredients.some(r => r.id == item.id)).flatMap(r => r.products.map(r => r.id));
        itemNode.possibleProducts = Array.from(new Set(possibleProductIds)).map(id => recipedata.items.find(i => i.id == id));
    }
    if (path.length > 10) {
        throw new Error('unexpected too deep');
    }
    for (const recipe of allRecipesExceptPour.filter(r => r.products.some(r => r.id == item.id))) {
        itemNode.children.push({
            data: recipe,
            depth: 2 * path.length + 1,
            children: recipe.ingredients.map(ingredient => collectRecipeTree(recipedata.items.find(i => i.id == ingredient.id), [...path, item.id])),
        });
    }
    return itemNode;
}

const MinDistance = 1;
function layoutRecipeTree(root: NodeLike) {
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
                    leftCursors[childIndex] = leftCursors[childIndex].thread;
                    leftCursorOffsets[childIndex] += leftCursors[childIndex].threadOffset;
                } else if (leftCursors[childIndex].children.length) {
                    leftCursors[childIndex] = leftCursors[childIndex].children[0];
                    leftCursorOffsets[childIndex] += leftCursors[childIndex].position;
                } else if (childIndex != activeIndexes[0] || activeIndexes.length == 1) {
                    leftCursors[childIndex] = null;
                }

                if (rightCursors[childIndex].thread) {
                    rightCursors[childIndex] = rightCursors[childIndex].thread;
                    rightCursorOffsets[childIndex] += rightCursors[childIndex].threadOffset;
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
                        thisnode.children[rightIndex].position += MinDistance - leftCursorOffsets[rightIndex] + rightCursorOffsets[leftIndex] - subtreeDistance;
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
                    leftCursors[nextLeftmostChildIndex].threadOffset = leftCursorOffsets[nextLeftmostChildIndex] - leftCursorOffsets[leftmostChildIndex] + subtreeDistance;
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
                    rightCursors[nextRightmostChildIndex].threadOffset = rightCursorOffsets[nextRightmostChildIndex] - rightCursorOffsets[rightmostChildIndex] - subtreeDistance;
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

        // children positions are relative position to left sibling child after the loop,
        // convert them to relative position to thisnode, or thisnode.position + thisnode.children[childIndex].preliminaryPosition = thisnode.children[childIndex].position
        // avg(leftmost, rightmost) is thisnode's position regarding thisnode.children[0]'s position as 0, so -avg is expected thisnode.children[0].position
        // NOTE keep floating point positions here and align to grid when finally rendering
        let currentPosition = -(leftmostDescendantPosition + rightmostDescendantPosition) / 2;
        for (const child of thisnode.children) {
            currentPosition = child.position += currentPosition;
        }
    }
    setup(root);

    let cursor = root;
    let cursorPosition = 0;
    let minCursorPosition = 0;
    while (true) {
        if (cursor.thread) {
            cursor = cursor.thread;
            cursorPosition += cursor.threadOffset;
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
    setPosition(root, -minCursorPosition);
}

function createRecipeItemElement(item: ItemData) {
    const itemElement = document.createElement('div');
    itemElement.dataset.id = item.id;
    itemElement.className = 'item-container';
    const imageElement = document.createElement('img');
    imageElement.alt = item.name;
    imageElement.src = imagedata[item.id];
    imageElement.width = 60;
    imageElement.height = 60;
    itemElement.appendChild(imageElement);
    const nameElement = document.createElement('div');
    nameElement.className = 'name';
    nameElement.innerText = item.name;
    itemElement.appendChild(nameElement);
    return itemElement;
}

function handleListItemClick(item: ItemData) {
    Array.from<HTMLLIElement>(elements.itemsContainer.children as any).map(c => c.className = c.dataset.id == item.id.toString() ? 'active' : '');
    elements.recipeContainer.innerHTML = '';

    const tree = collectRecipeTree(item, []);
    // console.log(tree);
    layoutRecipeTree(tree);

    let maxDepth = 0;
    // you can go down boundaries of the tree for this information,
    // but I'd like to avoid layout algorithm interns outside, so visit all nodes
    let [minPosition, maxPosition] = [100, -100];
    function collectCoordinates(node) {
        // console.log(`#${node.data.id}: ${node.depth}, ${node.position}`);
        maxDepth = Math.max(maxDepth, node.depth);
        minPosition = Math.min(minPosition, node.position);
        maxPosition = Math.max(maxPosition, node.position);
        for (const child of node.children) {
            collectCoordinates(child);
        }
    }
    collectCoordinates(tree);

    const rendercontext = {
        itemWidth: 88, // this is result render width, which is tree's depth direction, not sibling direction
        recipeWidth: 88,
        itemHeight: 88,
    };
    function isItemNode(node: ItemNode | RecipeNode): node is ItemNode {
        return node.data.id.startsWith('item_');
    }
    function displayTree(node: ItemNode | RecipeNode) {
        if (isItemNode(node)) {
            const element = createRecipeItemElement(node.data);
            elements.recipeContainer.appendChild(element);
            // max depth is lowest left
            element.style.left = `${20 + (maxDepth - node.depth) * rendercontext.itemWidth}px`;
            // min position is lowest top
            element.style.top = `${20 + (node.position - minPosition) * rendercontext.itemHeight}px`;
        } else {
            const machineName = recipedata.machines.find(m => m.id == node.data.machineId).name;
            const ingredients = node.data.ingredients.map(({ id, count }) => `${recipedata.items.find(i => i.id == id).name}x${count}`).join(',');
            const element = document.createElement('div');
            element.innerText = `${machineName}:${ingredients},${node.data.time}s`;
            element.className = 'item-container';
            elements.recipeContainer.appendChild(element);
            element.style.left = `${20 + (maxDepth - node.depth) * rendercontext.itemWidth}px`;
            element.style.top = `${20 + (node.position - minPosition) * rendercontext.itemHeight}px`;
        }
        for (const child of node.children) {
            displayTree(child);
        }
    }
    displayTree(tree);
}
