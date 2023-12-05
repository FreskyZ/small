// tsc index.ts --target es6 --lib dom,es2020
// npx terser --ecma 2020 --compress --mangle --output index.min.js -- index.js

// range(1, 10), this is used frequently
const seq = [1, 2, 3, 4, 5, 6, 7, 8, 9];
// index start from 1, returned row start from 1, column start from 1
function indexToRowColumn(index: number): [number, number] {
    return [Math.floor((index - 1) / 3) + 1, (index - 1) % 3 + 1];
}
// row start from 1, column start from 1, returned index start from 1
function rowColumnToIndex(row: number, column: number): number {
    return (row - 1) * 3 + column;
}
// enable or disable classname
function classControl(element: Element, className: string, on: boolean) {
    on ? element.classList.add(className) : element.classList.remove(className);
}

// --------------------------------------
// region view, ui elements

interface CellElement {
    // div.cell.cell-1.row-1.col-1
    self: HTMLDivElement,
    // div.value
    value: HTMLDivElement,
    // div.draft.draft-1
    // index start from 1, 0 is dummy
    drafts: HTMLDivElement[],
}
interface BlockElement {
    // index start from 1, 0 is dummy
    cells: CellElement[],
}
interface PanelElement {
    // button.toggle, shift, toggle pen or pencil, button toggle icon
    toggle: HTMLButtonElement,
    // button.undo, z, button disabled when nothing to undo
    undo: HTMLButtonElement,
    // button.redo, y, button disabled when nothing to redo
    redo: HTMLButtonElement,
    // button.auto-pencil, auto fill pencil
    autoPencil: HTMLButtonElement,
    // button.auto-fill, try auto fill
    autoFill: HTMLButtonElement,
    // button.take-snapshot
    takeSnapshot: HTMLButtonElement,
    // button.load-snapshot,
    loadSnapshot: HTMLButtonElement,
    // button.export
    exportButton: HTMLButtonElement,
    // button.import
    importButton: HTMLButtonElement,
    // button.clear
    clear: HTMLButtonElement,
    // button.number.number-1, index start from 1, 0 is dummy
    // click to same-value this number if this number is not on board
    numbers: HTMLButtonElement[],
    // no save/load, that's auto
    // no check, only a success modal when complete
}
interface UIElement {
    panel: PanelElement,
    reasons: HTMLDivElement,
    // index start from 1, 0 is dummy
    blocks: BlockElement[],
}
function makeui(): UIElement {
    const board = document.querySelector('div.board') as HTMLDivElement;
    board.className = 'board';
    const blocks = [null as unknown as BlockElement];
    seq.forEach(blockIndex => {
        const block = document.createElement('div');
        const [row, column] = indexToRowColumn(blockIndex);
        block.className = `block block-${blockIndex} row-${row} col-${column}`;
        board.appendChild(block);
        const cells = [null as unknown as CellElement];
        seq.forEach(cellIndex => {
            const cell = document.createElement('div');
            const [row, column] = indexToRowColumn(cellIndex);
            cell.className = `cell cell-${cellIndex} row-${row} col-${column}`;
            cell.tabIndex = 0;
            block.appendChild(cell);
            const drafts = [null as unknown as HTMLDivElement];
            seq.forEach(draftIndex => {
                const draft = document.createElement('div');
                draft.className = `draft draft-${draftIndex}`;
                draft.innerText = draftIndex.toString();
                cell.appendChild(draft);
                drafts.push(draft);
            });
            const value = document.createElement('div');
            value.className = 'value';
            cell.appendChild(value);
            cells.push({ self: cell, drafts, value });
        });
        blocks.push({ cells });
    });

    const toggle = document.querySelector('button.toggle') as HTMLButtonElement;
    const undo = document.querySelector('button.undo') as HTMLButtonElement;
    const redo = document.querySelector('button.redo') as HTMLButtonElement;
    const autoPencil = document.querySelector('button.auto-pencil') as HTMLButtonElement;
    const autoFill = document.querySelector('button.auto-fill') as HTMLButtonElement;
    const takeSnapshot = document.querySelector('button.take-snapshot') as HTMLButtonElement;
    const loadSnapshot = document.querySelector('button.load-snapshot') as HTMLButtonElement;
    const exportButton = document.querySelector('button.export') as HTMLButtonElement;
    const importButton = document.querySelector('button.import') as HTMLButtonElement;
    const clear = document.querySelector('button.clear') as HTMLButtonElement;

    const panel = document.querySelector('div.panel') as HTMLDivElement;
    const numbers = [null as unknown as HTMLButtonElement].concat(seq.map(numberIndex => {
        const number = document.createElement('button');
        number.className = `number number-${numberIndex}`;
        number.innerText = numberIndex.toString();
        panel.appendChild(number);
        return number;
    }));

    const reasons = document.querySelector('div.reasons') as HTMLDivElement;

    return { panel: { toggle, undo, redo, autoPencil, autoFill,
        takeSnapshot, loadSnapshot, exportButton, importButton, clear, numbers }, reasons, blocks };
}

// --------------------------------------
// region model, or data, this is serialized data, not runtime data

// [block index, cell index], start from 1
type CellId = readonly [number, number];
// this is sparse, no value and no draft cell not included
interface CellData {
    id: CellId,
    value: number,
    drafts: number[],
}

// --------------------------------------
// region view model base, rule irrelavent part, connect ui and data

class Draft {
    public readonly board: Board;
    public readonly block: Block;
    public readonly cell: Cell;
    public readonly index: number; // index in cell, which is also its display value
    public constructor(board: Board, block: Block, cell: Cell, index: number, element: HTMLDivElement) {
        this.board = board;
        this.block = block;
        this.cell = cell;
        this.index = index;
        this.element = element;
        this._enabled = false;
    }

    public readonly element: HTMLDivElement;
    public style(className: string, on: boolean) { classControl(this.element, className, on); }

    private _enabled: boolean;
    public get enabled(): boolean { return this._enabled; }
    public set enabled(v: boolean) { this._enabled = v; classControl(this.element, 'visible', v); }
}

class Cell {
    public readonly board: Board;
    public readonly block: Block;
    public readonly id: [number, number]; // [block index, cell index], cell index is index in block, start from 1
    public readonly coordinate: [number, number]; // [row, column], coordinate in block, start from 1 to 3
    public readonly globalCoordinate: [number, number]; // [row, column], coordinate in board, start from 1 to 9
    public readonly drafts: Draft[];     // index start from 1, 0 is dummy, true for draft enable

    // cell index start from 1
    public constructor(board: Board, block: Block, index: number, element: CellElement) {
        this.board = board;
        this.block = block;
        this.id = [block.index, index];
        this.coordinate = indexToRowColumn(index);
        this.globalCoordinate = [
            // block 123 map to base address 1, 456 to 4, 789 to 7, then add (this.row - 1)
            Math.floor((block.index - 1) / 3) * 3 + this.row,
            // block 123 map to base address 147, 456 to 147, 789 to 147, then add (this.column - 1)
            (block.index - 1) % 3 * 3 + this.column,
        ];
        this._value = null as unknown as number;
        this.drafts = [null as unknown as Draft]
            .concat(seq.map(draftIndex => new Draft(board, block, this, draftIndex, element.drafts[draftIndex])));
        this.cellElement = element.self;
        this.valueElement = element.value;
    }

    public get row() { return this.coordinate[0]; }
    public get column() { return this.coordinate[1]; }
    public get globalRow() { return this.globalCoordinate[0]; }
    public get globalColumn() { return this.globalCoordinate[1]; }

    public readonly cellElement: HTMLDivElement;
    public readonly valueElement: HTMLDivElement;
    public focus() { this.cellElement.focus(); }
    public isFocused() { return this.cellElement == document.activeElement; }
    public style(className: string, on: boolean) { classControl(this.cellElement, className, on); }

    public _value: number; // null for empty
    public get value(): number { return this._value; }
    public set value(v: number | null) { this._value = v as number; this.valueElement.innerText = v ? v.toString() : ''; }

    public isId(id: CellId) { return this.id[0] == id[0] && this.id[1] == id[1]; }
    public isSame(rhs: Cell) { return this.isId(rhs.id); }
    public isSameValue(rhs: Cell) { return !!this._value && this._value == rhs._value; }
    public isSameGroup(rhs: Cell) {
        return this.globalRow == rhs.globalRow
            || this.globalColumn == rhs.globalColumn
            || this.block.index == rhs.block.index;
    }

    // this may be widely used
    public forEach(callback: (draft: Draft) => any) {
        seq.forEach(draftIndex => callback(this.drafts[draftIndex]));
    }
    // this may be widely used
    public map<T>(callback: (draft: Draft) => T): T[] {
        return seq.map(draftIndex => callback(this.drafts[draftIndex]));
    }

    // these 2 functions do not care about operation history
    public apply(op: Operation) {
        const cell = this; // keep separated from this, in case I move this outside of Cell again
        if (op.kind == 'draft-on') {
            if (cell.value) {
                throw 'invalid operation, draft on when have final value';
            } else if (cell.drafts[op.value!].enabled) {
                throw 'invalid operation, draft on duplicate';
            }
            cell.drafts[op.value!].enabled = true;
        } else if (op.kind == 'draft-off') {
            if (cell.value) {
                throw 'invalid operation, draft off when have final value';
            } else if (!cell.drafts[op.value!].enabled) {
                throw 'invalid operation, draft off when not exist';
            }
            cell.drafts[op.value!].enabled = false;
        } else if (op.kind == 'set-value') {
            op.oldValue = cell.value;
            op.oldDrafts = this.map(draft => draft.enabled ? draft.index : 0).filter(x => x);
            op.otherCells = [];
            this.board.forEach(other => {
                if (cell.isSameGroup(other) && !cell.isSame(other) && other.drafts[op.value!].enabled) {
                    other.drafts[op.value!].enabled = false;
                    op.otherCells?.push(other.id);
                }
            })
            cell.forEach(draft => draft.enabled = false);
            cell.value = op.value!;
        } else if (op.kind == 'clear-value') {
            if (!cell.value) {
                throw 'invalid operation, clear final value when not have final value';
            }
            op.oldValue = cell.value;
            cell.value = null;
        } else if (op.kind == 'auto-pencil') {
            op.otherCells ??= [];
            if (!cell.value && !cell.map(draft => draft.enabled ? 1 : 0).some(x => x)) {
                const values = this.board.map(x => x)
                    .filter(other => cell.isSameGroup(other) && other.value).map(other => other.value);
                for (const value of seq.filter(v => !values.includes(v))) {
                    cell.drafts[value].enabled = true;
                }
                op.otherCells?.push(cell.id);
            }
        }
    }
    public reverseApply(op: Operation) {
        const cell = this;
        if (op.kind == 'draft-on') {
            if (cell.value) {
                throw 'invalid reverse operation, cannot reverse draft on when have final value'
            } else if (!cell.drafts[op.value!].enabled) {
                throw 'invalid reverse opration, cannot reverse draft on when that is not on';
            }
            cell.drafts[op.value!].enabled = false;
        } else if (op.kind == 'draft-off') {
            if (cell.value) {
                throw 'invalid reverse operation, cannot reverse draft off when have final value'
            } else if (cell.drafts[op.value!].enabled) {
                throw 'invalid reverse opration, cannot reverse draft off when that is not off';
            }
            cell.drafts[op.value!].enabled = true;
        } else if (op.kind == 'set-value') {
            cell.value = op.oldValue!;
            op.oldDrafts?.forEach(draftIndex => cell.drafts[draftIndex].enabled = true);
            op.otherCells?.forEach(id => this.board.byId(id).drafts[op.value!].enabled = true);
        } else if (op.kind == 'clear-value') {
            if (cell.value) {
                throw 'invalid operation, cannot reverse clear final value when have final value';
            }
            cell.value = op.oldValue!;
        } else if (op.kind == 'auto-pencil') {
            if (op.otherCells?.some(id => cell.isId(id))) {
                cell.forEach(draft => draft.enabled = false);
            }
        }
    }
}

class Block {
    public readonly board: Board;
    public element: BlockElement;
    public readonly index: number;
    public readonly row: number;
    public readonly column: number;
    public readonly cells: Cell[]; // index start from 1, 0 is dummy

    public constructor(board: Board, index: number, element: BlockElement) {
        this.board = board;
        this.element = null as unknown as BlockElement;
        this.index = index;
        [this.row, this.column] = indexToRowColumn(index);
        this.cells = [null as unknown as Cell]
            .concat(seq.map(cellIndex => new Cell(board, this, cellIndex, element.cells[cellIndex])));
    }
    // this may be widely used
    public forEach(callback: (cell: Cell) => any) {
        seq.forEach(cellIndex => callback(this.cells[cellIndex]));
    }
    // this may be widely used
    public map<T>(callback: (cell: Cell) => T): T[] {
        return seq.map(cellIndex => callback(this.cells[cellIndex]));
    }
}

class Board {
    public readonly blocks: Block[]; // index start from 1, 0 is dummy
    
    constructor(element: UIElement) {
        this.blocks = [null as unknown as Block]
            .concat(seq.map(blockIndex => new Block(this, blockIndex, element.blocks[blockIndex])));
    }

    public getCellData(): CellData[] {
        const results: CellData[] = [];
        this.forEach(cell => {
            if (!!cell.value || seq.some(draftIndex => cell.drafts[draftIndex].enabled)) {
                results.push({
                    id: cell.id,
                    value: cell.value,
                    drafts: seq.filter(draftIndex => cell.drafts[draftIndex].enabled),
                });
            }
        });
        return results;
    }
    public setCellData(cellDatas: CellData[]) {
        this.forEach(cell => {
            const cellData = cellDatas.find(d => cell.isId(d.id));
            if (cellData) {
                cell.value = cellData.value;
                cell.forEach(draft => draft.enabled = cellData.drafts.includes(draft.index));
            } else {
                cell.value = null;
                cell.forEach(draft => draft.enabled = false);
                seq.forEach(draftIndex => cell.drafts[draftIndex].enabled = false);
            }
        });
    }

    // this is widely used
    public forEach(callback: (cell: Cell) => any) {
        seq.forEach(blockIndex => seq.forEach(cellIndex => callback(this.blocks[blockIndex].cells[cellIndex])));
    }
    // this seems widely used
    public map<T>(callback: (cell: Cell) => T): T[] {
        const result: T[] = [];
        seq.forEach(blockIndex => seq.forEach(cellIndex => result.push(callback(this.blocks[blockIndex].cells[cellIndex]))));
        return result;
    }

    public byId(id: CellId) {
        return this.blocks[id[0]].cells[id[1]];
    }
    // board row and board column start from 1
    public byGlobalCoordinate([globalRow, globalColumn]: [number, number]) {
        return this.blocks[
            // block's row = Math.floor((boardRow - 1) / 3) + 1
            // block's column = Math.floor((boardColumn - 1) / 3) + 1
            Math.floor((globalRow - 1) / 3) * 3 + Math.floor((globalColumn - 1) / 3) + 1
        ].cells[
            // cell's row = (boardRow - 1) % 3 + 1;
            // cell's column = (boardColumn - 1) % 3 + 1;
            (globalRow - 1) % 3 * 3 + (globalColumn - 1) % 3 + 1
        ];
    }

    public isComplete() {
        return !this.map(cell => cell.value).some(v => !v) // not any cell does not have value
            // every row is complete 1-9
            && !seq.some(row => seq.map(column => this.byGlobalCoordinate([row, column]).value).sort().some((v, i) => v != i + 1))
            // every column is complete 1-9
            && !seq.some(column => seq.map(row => this.byGlobalCoordinate([row, column]).value).sort().some((v, i) => v != i + 1))
            // every block is complete 1-9
            && !seq.some(blockIndex => seq.map(cellIndex => this.blocks[blockIndex].cells[cellIndex].value).sort().some((v, i) => v != i + 1));
    }
}

// ----------------------------------------
// region user interactive, here handles rule

interface Operation {
    kind: 'draft-on' | 'draft-off' | 'set-value' | 'clear-value' | 'auto-pencil',
    // not used in auto-pencil
    id: CellId,
    // value for draft-on, draft-off, set-value
    value?: number,
    // stored old value for set-value or clear-value
    oldValue?: number,
    // old draft values in this cell for set-value
    oldDrafts?: number[],
    // other same group cell cleared specific draft value by set-value,
    // or updated auto-pencil cells
    otherCells?: CellId[],
}

class Rule {
    public readonly board: Board;
    public readonly element: PanelElement;
    // item is null for invalidated (go back and do another)
    public readonly operations: Operation[] = [null as unknown as Operation];
    // start from 1 to make 0 invalid operation index
    // next call to this.push will be in this.operations[this.operationIndex]
    public operationIndex: number = 1;
    // operationindex start from 1 to make 0 means no snapshot 
    public snapshotIndex: number;
    // additional panel state
    public isPencil: boolean;
    // start from 1, 0 for not active
    public externalActiveNumber: number;
    // or else alert(complete) and close alert will focus back and alert again
    // this is not saved or cleared by clear
    private reportedComplete: boolean;

    public constructor(board: Board, element: UIElement) {
        this.board = board;
        this.element = element.panel;
        this.operations = [null as unknown as Operation];
        this.operationIndex = 1;
        this.snapshotIndex = 0;
        this.isPencil = false;
        this.externalActiveNumber = 0;
        this.reportedComplete = false;
    
        const savedatastring = localStorage.getItem('PAGEDATA');
        if (savedatastring) {
            const savedata = JSON.parse(savedatastring);
            this.board.setCellData(savedata.cellData);
            this.operations = savedata.operations;
            this.operationIndex = savedata.operationIndex;
            this.snapshotIndex = savedata.snapshotIndex;
            this.isPencil = savedata.isPencil;
        }

        this.board.forEach(cell => {
            cell.cellElement.addEventListener('focus', () => this.update());
            cell.cellElement.addEventListener('keydown', e => this.handleKeydown(cell, e));
        });
        document.addEventListener('keydown', e => this.handleKeydown(null, e));
        this.element.toggle.addEventListener('click', this.handleToggle);
        this.element.undo.addEventListener('click', this.handleUndo);
        this.element.redo.addEventListener('click', this.handleRedo);
        this.element.autoPencil.addEventListener('click', this.handleAutoPencil);
        this.element.autoFill.addEventListener('click', this.handleAutoFill);
        this.element.takeSnapshot.addEventListener('click', this.handleTakeSnapshot);
        this.element.loadSnapshot.addEventListener('click', this.handleLoadSnapshot);
        this.element.exportButton.addEventListener('click', this.handleExport);
        this.element.importButton.addEventListener('click', this.handleImport);
        this.element.clear.addEventListener('click', this.handleClear);
        seq.forEach(n => this.element.numbers[n].addEventListener('click', () => this.handleNumberClick(n)));

        this.update();
    }

    // similar to the per frame handler in real time game,
    // this is called every time game is interacted to update related state
    private update() {

        // same group hint and same value hint
        const activeCell = this.board.map(x => x).find(cell => cell.isFocused());
        if (activeCell) {
            this.externalActiveNumber = 0;
            this.board.forEach(other => {
                // don't forget to off not meet condition cells
                const sameGroup = activeCell.isSameGroup(other);
                const sameValue = activeCell.isSameValue(other);
                other.style('same-group-hint', sameGroup);
                other.style('same-value-hint', !sameGroup && sameValue);
                other.forEach(draft => {
                    draft.style('same-value-hint', draft.enabled && !sameGroup && !!activeCell._value && draft.index == activeCell._value);
                });
            });
        } else {
            this.board.forEach(cell => {
                cell.style('same-value-hint', cell.value == this.externalActiveNumber);
                cell.forEach(draft => {
                    draft.style('same-value-hint', draft.enabled && draft.index == this.externalActiveNumber);
                });
            });
        }

        // duplicate hint
        this.board.forEach(cell => {
            cell.style('duplicate-hint', false);
            cell.forEach(draft => draft.style('duplicate-hint', false));
        })
        this.board.forEach(lhs => {
            this.board.forEach(rhs => {
                if (lhs.isSameGroup(rhs) && !lhs.isSame(rhs)) {
                    if (lhs.isSameValue(rhs)) {
                        lhs.style('duplicate-hint', true);
                        rhs.style('duplicate-hint', true);
                    }
                    rhs.forEach(draft => {
                        if (draft.enabled && !!lhs._value && draft.index == lhs.value) {
                            draft.style('duplicate-hint', true);
                        }
                    });
                    lhs.forEach(draft => {
                        if (draft.enabled && !!rhs._value && draft.index == rhs.value) {
                            draft.style('duplicate-hint', true);
                        }
                    });
                }
            });
        });

        // panel style
        classControl(this.element.toggle, 'pen', !this.isPencil);
        classControl(this.element.toggle, 'pencil', this.isPencil);
        this.element.undo.disabled = this.operationIndex <= 1;
        this.element.redo.disabled = this.operations.length <= this.operationIndex || this.operations[this.operationIndex] == null;
        this.element.loadSnapshot.disabled = !this.snapshotIndex || this.operations[this.snapshotIndex] == null;
        this.element.autoFill.disabled = !this.inferer;
        seq.forEach(numberIndex => classControl(this.element.numbers[numberIndex], 'active', this.externalActiveNumber == numberIndex));

        // complete!
        if (!this.reportedComplete && this.board.isComplete()) {
            alert('complete!');
            this.reportedComplete = true;
        }
        
        // save data to local storage
        localStorage.setItem('PAGEDATA', JSON.stringify({
            cellData: this.board.getCellData(),
            operations: this.operations,
            operationIndex: this.operationIndex,
            snapshotIndex: this.snapshotIndex,
            isPencil: this.isPencil,
        }));
    }

    // only these 2 functions alternate operation history
    public do(op: Operation) {
        if (this.operations.length == this.operationIndex) {
            this.operations.push(op);
        } else {
            this.operations[this.operationIndex] = op;
            for (let index = this.operationIndex + 1; index < this.operations.length; index += 1) {
                this.operations[index] = null as unknown as Operation;
            }
        }
        if (op.kind == 'auto-pencil') {
            this.board.forEach(cell => cell.apply(op));
        } else {
            this.board.byId(op.id).apply(op);
        }
        this.operationIndex += 1;
        this.update();
    }
    // negative for go back, positive for go forward
    public go(offset: number) {
        if (offset < 0) {
            // reverse apply from this.index - 1 to this.index - 1 - abs(offset) left inclusive, right exclusive
            // e.g. this.index = 5, offset = -1, reverse apply 4, this.index become 4
            // e.g. this.index = 5, offset = -3, reverse apply 4, 3, 2, this.index become 2;
            for (let index = this.operationIndex - 1; index > this.operationIndex + offset - 1; index -= 1) {
                if (index <= 0 || index >= this.operations.length || this.operations[index] == null) {
                    throw 'invalid go backward';
                }
                const op = this.operations[index];
                if (op.kind == 'auto-pencil') {
                    this.board.forEach(cell => cell.reverseApply(op));
                } else {
                    this.board.byId(op.id).reverseApply(op);
                }
                // go back does not invalidate these operations
            }
        } else if (offset > 0) {
            // e.g. this.index = 5, offset = 1, apply 5, this.index become 5
            // e.g. this.index = 5, offset = 3, apply 5, 6, 7, this.index become 8
            for (let index = this.operationIndex; index < this.operationIndex + offset; index += 1) {
                if (index <= 0 || index >= this.operations.length || this.operations[index] == null) {
                    throw 'invalid go forward';
                }
                const op = this.operations[index];
                if (op.kind == 'auto-pencil') {
                    this.board.forEach(cell => cell.apply(op));
                } else {
                    this.board.byId(op.id).apply(op);
                }
            }
        }
        this.operationIndex += offset;
        this.update();
    }

    private handleToggle = () => {
        this.isPencil = !this.isPencil;
        this.update();
    }

    private handleUndo = () => {
        if (this.operationIndex > 0) {
            this.go(-1);
            this.update();
        }
    }
    private handleRedo = () => {
        if (this.operations.length > this.operationIndex && this.operations[this.operationIndex] != null) {
            this.go(1);
            this.update();
        }
    }

    private handleAutoPencil = () => {
        this.do({ kind: 'auto-pencil', id: [0, 0] });
    }

    private inferer: InferLike;
    public setInferer(inferer: InferLike) {
        this.inferer = inferer;
        this.update();
    }
    private handleAutoFill = () => {
        this.inferer.infer();
    }

    private handleTakeSnapshot = () => {
        this.snapshotIndex = this.operationIndex;
        this.update();
    }
    private handleLoadSnapshot = () => {
        if (this.snapshotIndex && this.operations[this.snapshotIndex] != null) {
            this.go(this.snapshotIndex - this.operationIndex);
            this.update();
        }
    }

    private handleExport = () => {
        // TODO make file download
    }
    private handleImport = () => {
        // TODO directlry read file upload
    }
    
    private handleClear = () => {
        this.board.setCellData([]);
        this.operations.splice(0, this.operations.length);
        this.operations.push(null as unknown as Operation);
        this.operationIndex = 1;
        this.snapshotIndex = 0;
        this.reportedComplete = false;
        this.update();
    }

    private handleNumberClick = (n: number) => {
        if (this.externalActiveNumber != n) {
            this.externalActiveNumber = n;
        } else {
            this.externalActiveNumber = 0;
        }
        this.update();
    }
    
    private handleKeydown = (cell: Cell | null, e: KeyboardEvent) => {
        if (e.key == 'Shift') {
            this.isPencil = !this.isPencil;
            e.stopPropagation();
        } else if (e.key == 'z' || e.key == 'Z') {
            if (this.operationIndex > 1) {
                this.go(-1);
            }
            e.stopPropagation();
        } else if (e.key == 'y' || e.key == 'Y') {
            if (this.operations.length > this.operationIndex && this.operations[this.operationIndex] != null) {
                this.go(1);
            }
            e.stopPropagation();
        } else if (e.key == 'r' || e.key == 'R') {
            if (this.snapshotIndex && this.operations[this.snapshotIndex] != null) {
                this.go(this.snapshotIndex - this.operationIndex);
            }
            e.stopPropagation();
        } else if (e.key == 'q' || e.key == 'Q') {
            this.inferer?.infer();
            e.stopPropagation();
        } else if (e.key == 'ArrowLeft' && cell != null) {
            let [row, column, blockRow, blockColumn] = [cell.row, cell.column, cell.block.row, cell.block.column];
            column -= 1;
            if (column == 0) {
                blockColumn -= 1;
                column = 3;
            }
            if (blockColumn > 0) {
                this.board.blocks[rowColumnToIndex(blockRow, blockColumn)].cells[rowColumnToIndex(row, column)].focus();
            }
        } else if (e.key == 'ArrowRight' && cell != null) {
            let [row, column, blockRow, blockColumn] = [cell.row, cell.column, cell.block.row, cell.block.column];
            column += 1;
            if (column > 3) {
                blockColumn += 1;
                column = 1;
            }
            if (blockColumn <= 3) {
                this.board.blocks[rowColumnToIndex(blockRow, blockColumn)].cells[rowColumnToIndex(row, column)].focus();
            }
        } else if (e.key == 'ArrowUp' && cell != null) {
            let [row, column, blockRow, blockColumn] = [cell.row, cell.column, cell.block.row, cell.block.column];
            row -= 1;
            if (row == 0) {
                blockRow -= 1;
                row = 3;
            }
            if (blockRow > 0) {
                this.board.blocks[rowColumnToIndex(blockRow, blockColumn)].cells[rowColumnToIndex(row, column)].focus();
            }
        } else if (e.key == 'ArrowDown' && cell != null) {
            let [row, column, blockRow, blockColumn] = [cell.row, cell.column, cell.block.row, cell.block.column];
            row += 1;
            if (row > 3) {
                blockRow += 1;
                row = 1;
            }
            if (blockRow <= 3) {
                this.board.blocks[rowColumnToIndex(blockRow, blockColumn)].cells[rowColumnToIndex(row, column)].focus();
            }
        } else if ((e.key == 'Backspace' || e.key == 'Delete') && cell != null) {
            if (cell.value) {
                this.do({ id: cell.id, kind: 'clear-value' });
            }
        } else if (['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(e.key)) {
            const value = parseInt(e.key);
            if (cell != null) {
                if (this.isPencil && !cell.value) {
                    if (cell.drafts[value].enabled) {
                        this.do({ id: cell.id, kind: 'draft-off', value });
                    } else {
                        this.do({ id: cell.id, kind: 'draft-on', value });
                    }
                } else if (!this.isPencil && cell.value != value) {
                    this.do({ id: cell.id, kind: 'set-value', value });
                }
            } else {
                if (this.externalActiveNumber != value) {
                    this.externalActiveNumber = value;
                } else {
                    this.externalActiveNumber = 0;
                }
            }
        }
        this.update();
    }
}

interface InferLike {
    infer: () => void,
}
class Infer {
    public readonly board: Board;
    public readonly element: HTMLDivElement;
    public constructor(board: Board, element: UIElement) {
        this.board = board;
        this.element = element.reasons;
    }

    private reason(reason: string) {
        const reasonElement = document.createElement('div');
        reasonElement.className = 'reason';
        reasonElement.innerText = reason;
        this.element.appendChild(reasonElement);
        reasonElement.scrollIntoView({ behavior: 'smooth' });
    }

    public infer() {
        this.element.innerHTML = '';
        if (![
            this.basic,
            this.singleOccurenceInGroup,
        ].find(x => x())) {
            this.reason('nothing for now');
        }
    }

    // same as auto pencil, when only one value possible, that's the result
    private basic = () => {
        let ok = false;
        this.board.forEach(cell => {
            if (!cell.value) {
                const existValues = this.board.map(x => x)
                    .filter(other => cell.isSameGroup(other) && other.value).map(other => other.value);
                const possibleValues = seq.filter(v => !existValues.includes(v));
                if (possibleValues.length == 1) {
                    ok = true;
                    this.reason(`basic: cell ${cell.globalCoordinate} value ${possibleValues[0]}`);
                } else if (possibleValues.length == 0) {
                    this.reason(`basic: btw, cell ${cell.globalCoordinate} is already incorrect with no possible values`);
                }
            }
        });
        return ok;
    }

    // single occurence in different types of group, this works on existing draft
    private singleOccurenceInGroup = () => {
        let ok = false;

        const handleCells = (cells: Cell[], groupName: string) => {
            // not work on some cell is empty and has no draft
            if (cells.some(cell => !cell.value && !cell.map(draft => draft.enabled ? 1 : 0).some(x => x))) {
                return false;
            }
            let ok = false;
            for (const possibleValue of seq) {
                const occurence = cells.filter(cell => !cell.value && cell.drafts[possibleValue].enabled);
                if (occurence.length == 1) {
                    ok = true;
                    this.reason(`single-occur: cell ${occurence[0].globalCoordinate} is ${possibleValue} because it is occurred only once in ${groupName}`);
                }
            }
            return ok;
        }

        for (const globalRow of seq) {
            const cells = seq.map(globalColumn => this.board.byGlobalCoordinate([globalRow, globalColumn]));
            let thisok = handleCells(cells, `row ${globalRow}`);
            ok ||= thisok;
        }
        for (const globalColumn of seq) {
            const cells = seq.map(globalRow => this.board.byGlobalCoordinate([globalRow, globalColumn]));
            let thisok = handleCells(cells, `column ${globalColumn}`);
            ok ||= thisok;
        }
        for (const blockIndex of seq) {
            const block = this.board.blocks[blockIndex];
            const cells = block.map(cell => cell);
            let thisok = handleCells(cells, `block ${block.row},${block.column}`);
            ok ||= thisok;
        }
        return ok;
    }
}

const ui = makeui();
const board = new Board(ui);
const rule = window['thegame'] = new Rule(board, ui);
rule.setInferer(new Infer(board, ui));
