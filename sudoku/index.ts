// tsc index.ts --target es6 --lib dom,es2020

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
// import EventEmitter from 'node:event'
class EventHandler<T> {
    private readonly _handlers: ((e: T) => any)[];
    public constructor() {
        this._handlers = [];
    }
    public on(handler: (e: T) => any) {
        this._handlers.push(handler);
    }
    public off(handler: (e: T) => any) {
        this._handlers.splice(this._handlers.indexOf(handler), 1);
    }
    public emit(e: T) {
        this._handlers.forEach(f => f(e));
    }
}

// --------------------------------------
// region view, ui elements

type DraftElement = HTMLDivElement;
interface CellElement {
    // div.cell.cell-1.row-1.col-1
    self: HTMLDivElement,
    // div.draft.draft-1
    // index start from 1, 0 is dummy
    drafts: DraftElement[],
    // div.value
    value: HTMLDivElement,
}
interface BlockElement {
    // div.block.block-1.row-1.col-1
    self: HTMLDivElement,
    // index start from 1, 0 is dummy
    cells: CellElement[],
}
interface BoardElement {
    container: Node,
    // div.board
    self: HTMLDivElement,
    // div.hint
    hint: HTMLDivElement,
    // index start from 1, 0 is dummy
    blocks: BlockElement[],
}
function makeBoardElement(container: Node, boardClassNames: string[] = []): BoardElement {
    const board = document.createElement('div');
    board.className = ['board'].concat(boardClassNames).join(' ');
    container.appendChild(board);
    const hint = document.createElement('div');
    hint.className = 'hint';
    container.appendChild(hint);
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
        blocks.push({ self: block, cells });
    });
    return { container, self: board, hint, blocks };
}

// --------------------------------------
// region model, or data, this is serialized data, not runtime data

// this is sparse, no value and no draft cell not included
interface CellData {
    blockIndex: number,
    cellIndex: number,
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
    public constructor(board: Board, block: Block, cell: Cell, index: number) {
        this.board = board;
        this.block = block;
        this.cell = cell;
        this.element = null as unknown as HTMLDivElement;
        this.index = index;
        this._enabled = false;
    }

    public element: DraftElement;
    public bind(element: DraftElement) {
        this.element = element;
    }
    public style(className: string, on: boolean) { classControl(this.element, className, on); }

    private _enabled: boolean;
    public get enabled(): boolean { return this._enabled; }
    public set enabled(v: boolean) { this._enabled = v; classControl(this.element, 'visible', v); }
}

class Cell {
    public readonly board: Board;
    public readonly block: Block;
    public readonly index: number;  // index in block, start from 1
    public readonly row: number;    // start from 1
    public readonly column: number; // start from 1
    public readonly drafts: Draft[];     // index start from 1, 0 is dummy, true for draft enable

    // cell index start from 1
    public constructor(board: Board, block: Block, index: number) {
        this.board = board;
        this.block = block;
        this.element = null as unknown as CellElement;
        this.index = index;
        [this.row, this.column] = indexToRowColumn(index);
        this._value = null as unknown as number;
        this.drafts = [null as unknown as Draft]
            .concat(seq.map(draftIndex => new Draft(board, block, this, draftIndex)));
        this.focusEvent = new EventHandler();
        this.blurEvent = new EventHandler();
        this.keydownEvent = new EventHandler();
    }

    // start from 1
    // block 123 map to base address 1, 456 to 4, 789 to 7, then add (this.row - 1)
    public get boardRow() { return Math.floor((this.block.index - 1) / 3) + this.row; }
    // start from 1
    // block 123 map to base address 147, 456 to 147, 789 to 147, then add (this.column - 1)
    public get boardColumn() { return (this.block.index - 1) % 3 * 3 + this.column; }

    public element: CellElement;
    public bind(element: CellElement) {
        if (this.element) {
            this.element.self.removeEventListener('focus', this.handleFocus);
            this.element.self.removeEventListener('blur', this.handleBlur);
            this.element.self.removeEventListener('keydown', this.handleKeydown);
        }
        this.element = element;
        this.forEach(draft => draft.bind(this.element.drafts[draft.index]));
        this.element.self.addEventListener('focus', this.handleFocus);
        this.element.self.addEventListener('blur', this.handleBlur);
        this.element.self.addEventListener('keydown', this.handleKeydown);
    }
    public focus() { this.element.self.focus(); }
    public style(className: string, on: boolean) { classControl(this.element.self, className, on); }

    public focusEvent: EventHandler<FocusEvent>;
    public blurEvent: EventHandler<FocusEvent>;
    public keydownEvent: EventHandler<KeyboardEvent>;
    private handleFocus = (e: FocusEvent) => { this.focusEvent.emit(e); }
    private handleBlur = (e: FocusEvent) => { this.blurEvent.emit(e); }
    private handleKeydown = (e: KeyboardEvent) => { this.keydownEvent.emit(e); }

    public _value: number; // null for empty
    public get value(): number { return this._value; }
    public set value(v: number | null) { this._value = v as number; this.element.value.innerText = v ? v.toString() : ''; }

    public isSameValue(rhs: Cell) { return !!this._value && this._value == rhs._value; }
    public isSameGroup(rhs: Cell) {
        return (this.row == rhs.row && this.block.row == rhs.block.row)
            || (this.column == rhs.column && this.block.column == rhs.block.column)
            || this.block.index == rhs.block.index;
    }
    // this is widely used
    public forEach(callback: (draft: Draft) => any) {
        seq.forEach(draftIndex => callback(this.drafts[draftIndex]));
    }
}

class Block {
    public readonly board: Board;
    public element: BlockElement;
    public readonly index: number;
    public readonly row: number;
    public readonly column: number;
    public readonly cells: Cell[]; // index start from 1, 0 is dummy

    public constructor(board: Board, index: number) {
        this.board = board;
        this.element = null as unknown as BlockElement;
        this.index = index;
        [this.row, this.column] = indexToRowColumn(index);
        this.cells = [null as unknown as Cell]
            .concat(seq.map(cellIndex => new Cell(board, this, cellIndex)));
    }
    public bind(element: BlockElement) {
        this.element = element;
        seq.forEach(cellIndex => this.cells[cellIndex].bind(element.cells[cellIndex]));
    }
}

class Board {
    public element: BoardElement;
    public readonly blocks: Block[]; // index start from 1, 0 is dummy
    
    constructor() {
        this.element = null as unknown as BoardElement;
        this.blocks = [null as unknown as Block]
            .concat(seq.map(blockIndex => new Block(this, blockIndex)));
    }

    public bind(element: BoardElement) {
        this.element = element;
        seq.forEach(blockIndex => this.blocks[blockIndex].bind(element.blocks[blockIndex]));
    }
    public save(): CellData[] {
        const results: CellData[] = [];
        this.forEach(cell => {
            if (!!cell.value || seq.some(draftIndex => cell.drafts[draftIndex].enabled)) {
                results.push({
                    blockIndex: cell.block.index,
                    cellIndex: cell.index,
                    value: cell.value,
                    drafts: seq.filter(draftIndex => cell.drafts[draftIndex].enabled),
                });
            }
        });
        return results;
    }
    public load(cellDatas: CellData[]) {
        this.forEach(cell => {
            const cellData = cellDatas.find(d => d.blockIndex == cell.block.index && d.cellIndex == cell.index);
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

    public hint(text: string) {
        this.element.hint.innerText = text;
    }
    
    // board row and board column start from 1
    public byBoardCoordinate(boardRow: number, boardColumn: number) {
        return this.blocks[
            // block's row = Math.floor((boardRow - 1) / 3) + 1
            // block's column = Math.floor((boardColumn - 1) / 3) + 1
            Math.floor((boardRow - 1) / 3) * 3 + Math.floor((boardColumn - 1) / 3) + 1
        ].cells[
            // cell's row = (boardRow - 1) % 3 + 1;
            // cell's column = (boardColumn - 1) % 3 + 1;
            (boardRow - 1) % 3 * 3 + (boardColumn - 1) % 3 + 1
        ];
    }
    // this is widely used
    public forEach(callback: (cell: Cell) => any) {
        seq.forEach(blockIndex => seq.forEach(cellIndex => callback(this.blocks[blockIndex].cells[cellIndex])));
    }
}

// ----------------------------------------
// region user interactive, here handles rule

interface Operation {
    // start from 1
    blockIndex: number,
    // start from 1
    cellIndex: number,
    // set value clears draft and stores draft in oldDrafts
    kind: 'draft-on' | 'draft-off' | 'set-value' | 'clear-value',
    // value for draft-on, draft-off, set-value
    value?: number,
    // stored old value for set-value or clear-value
    oldValue?: number,
    // old draft values for set-value
    oldDrafts?: number[],
}

class Rule {
    public readonly board: Board;
    public operations: Operation[]; // null for invalidated (go back and push)
    public operationIndex: number; // next call to this.push will be in this.operations[this.operationIndex]
    public snapshotIndex: number;
    public pencil: boolean;

    public constructor(board: Board) {
        this.operations = [];
        this.operationIndex = 0;
        this.board = board;
        this.pencil = false;
        this.board.forEach(cell => {
            cell.focusEvent.on(e => this.handleFocus(cell, e));
            cell.blurEvent.on(e => this.handleBlur(cell, e));
            cell.keydownEvent.on(e => this.handleKeydown(cell, e));
        });
    }
    
    // these 2 functions do not care about operation history
    private apply(op: Operation) {
        const cell = this.board.blocks[op.blockIndex].cells[op.cellIndex];
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
            op.oldDrafts = seq.filter(draftIndex => cell.drafts[draftIndex].enabled);
            cell.forEach(draft => draft.enabled = false);
            cell.value = op.value!;
        } else if (op.kind == 'clear-value') {
            if (!cell.value) {
                throw 'invalid operation, clear final value when not have final value';
            }
            op.oldValue = cell.value;
            cell.value = null;
        }
    }
    private reverseApply(op: Operation) {
        const cell = this.board.blocks[op.blockIndex].cells[op.cellIndex];
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
            op.oldDrafts!.forEach(draftIndex => cell.drafts[draftIndex].enabled = true);
        } else if (op.kind == 'clear-value') {
            if (cell.value) {
                throw 'invalid operation, cannot reverse clear final value when have final value';
            }
            cell.value = op.oldValue!;
        }
    }

    // only these 2 functions operate on operation history
    public push(op: Operation) {
        if (this.operations.length == this.operationIndex) {
            this.operations.push(op);
        } else {
            this.operations[this.operationIndex] = op;
            for (let index = this.operationIndex + 1; index < this.operations.length; index += 1) {
                this.operations[index] = null as unknown as Operation;
            }
        }
        this.apply(op);
        this.operationIndex += 1;
        this.restyle();
        // ATTENTION temp auto save here
        localStorage.setItem('data', JSON.stringify(this.board.save()));
        localStorage.setItem('hist', JSON.stringify(this.operations));
        localStorage.setItem('histi', this.operationIndex.toString());
        localStorage.setItem('hists', this.snapshotIndex?.toString());
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
                this.reverseApply(this.operations[index]);
                // go back does not invalidate these operations
            }
        } else if (offset > 0) {
            // e.g. this.index = 5, offset = 1, apply 5, this.index become 5
            // e.g. this.index = 5, offset = 3, apply 5, 6, 7, this.index become 8
            for (let index = this.operationIndex; index < this.operationIndex + offset; index += 1) {
                if (index <= 0 || index >= this.operations.length || this.operations[index] == null) {
                    throw 'invalid go forward';
                }
                this.apply(this.operations[index]);
            }
        }
        this.operationIndex += offset;
        this.restyle();
        // ATTENTION temp auto save here
        localStorage.setItem('data', JSON.stringify(this.board.save()));
        localStorage.setItem('hist', JSON.stringify(this.operations));
        localStorage.setItem('histi', this.operationIndex.toString());
        localStorage.setItem('hists', this.snapshotIndex?.toString());
    }

    public takeSnapshot() {
        this.snapshotIndex = this.operationIndex;
        console.log(`take snapshot ${this.snapshotIndex}`);
    }
    public recoverSnapshot() {
        if (this.snapshotIndex) {
            console.log(`recover snapshot ${this.snapshotIndex}`);
            this.goto(this.snapshotIndex);
        }
    }
    public goto(newOperationIndex: number) {
        this.go(newOperationIndex - this.operationIndex);
    }
    
    // ATTENTION currently this corrupts operation history
    public autoPencil() {
        this.board.forEach(cell => {
            if (!cell.value) {
                const values: Set<number> = new Set();
                this.board.forEach(other => {
                    if (other.value && other.isSameGroup(cell)) {
                        values.add(other.value);
                    }
                });
                const allValues = [1, 2, 3, 4, 5, 6, 7, 8, 9];
                for (const value of allValues.filter(v => !values.has(v) && !cell.drafts[v].enabled)) {
                    cell.drafts[value].enabled = true;
                }
            }
        });
    }

    public check() {
        let filled = true;
        this.board.forEach(cell => { if (!cell.value) { filled = false; } });
        if (!filled) { return alert('not filled'); }


    }

    private restyle() {
        // same group and same value work for focus
        let activeCell: Cell = null as unknown as Cell;
        this.board.forEach(cell => { if (document.activeElement == cell.element.self) { activeCell = cell; } });
        if (activeCell) {
            this.board.forEach(other => {
                // don't forget to off not meet condition cells
                const sameGroup = activeCell.isSameGroup(other);
                const sameValue = activeCell.isSameValue(other);
                other.style('same-group-hint', sameGroup);
                other.style('same-value-hint', sameValue && !sameGroup);
                other.forEach(draft => {
                    draft.style('same-value-hint', draft.enabled && !!activeCell._value && draft.index == activeCell._value && !sameGroup);
                });
            });
        }
        // duplicate work for all
        this.board.forEach(cell => {
            cell.style('duplicate-hint', false);
            cell.forEach(draft => draft.style('duplicate-hint', false));
        })
        this.board.forEach(lhs => {
            this.board.forEach(rhs => {
                if ((lhs.block.index != rhs.block.index || lhs.index != rhs.index) && lhs.isSameGroup(rhs)) {
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
            })
        });
    }
    private handleFocus = (cell: Cell, e: FocusEvent) => {
        this.restyle();
    }
    private handleBlur = (cell: Cell, e: FocusEvent) => {
        // nothing for now, this.restyle correct off other cells and drafts
        // this.restyle();
    }
    
    private handleKeydown = (cell: Cell, e: KeyboardEvent) => {
        if (e.key == 'ArrowLeft') {
            let [row, column, blockRow, blockColumn] = [cell.row, cell.column, cell.block.row, cell.block.column];
            column -= 1;
            if (column == 0) {
                blockColumn -= 1;
                column = 3;
            }
            if (blockColumn > 0) {
                this.board.blocks[rowColumnToIndex(blockRow, blockColumn)].cells[rowColumnToIndex(row, column)].focus();
            }
        } else if (e.key == 'ArrowRight') {
            let [row, column, blockRow, blockColumn] = [cell.row, cell.column, cell.block.row, cell.block.column];
            column += 1;
            if (column > 3) {
                blockColumn += 1;
                column = 1;
            }
            if (blockColumn <= 3) {
                this.board.blocks[rowColumnToIndex(blockRow, blockColumn)].cells[rowColumnToIndex(row, column)].focus();
            }
        } else if (e.key == 'ArrowUp') {
            let [row, column, blockRow, blockColumn] = [cell.row, cell.column, cell.block.row, cell.block.column];
            row -= 1;
            if (row == 0) {
                blockRow -= 1;
                row = 3;
            }
            if (blockRow > 0) {
                this.board.blocks[rowColumnToIndex(blockRow, blockColumn)].cells[rowColumnToIndex(row, column)].focus();
            }
        } else if (e.key == 'ArrowDown') {
            let [row, column, blockRow, blockColumn] = [cell.row, cell.column, cell.block.row, cell.block.column];
            row += 1;
            if (row > 3) {
                blockRow += 1;
                row = 1;
            }
            if (blockRow <= 3) {
                this.board.blocks[rowColumnToIndex(blockRow, blockColumn)].cells[rowColumnToIndex(row, column)].focus();
            }
        } else if (e.key == 'Backspace' || e.key == 'Delete') {
            if (cell.value) {
                this.push({ blockIndex: cell.block.index, cellIndex: cell.index, kind: 'clear-value' });
            }
        } else if (['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(e.key)) {
            const value = parseInt(e.key);
            if (this.pencil && !cell.value) {
                if (cell.drafts[value].enabled) {
                    this.push({ blockIndex: cell.block.index, cellIndex: cell.index, kind: 'draft-off', value });
                } else {
                    this.push({ blockIndex: cell.block.index, cellIndex: cell.index, kind: 'draft-on', value });
                }
            } else if (!this.pencil && cell.value != value) {
                this.push({ blockIndex: cell.block.index, cellIndex: cell.index, kind: 'set-value', value });
            }
        } else if (e.key == 'z' || e.key == 'Z') {
            this.go(-1);
        } else if (e.key == 'y' || e.key == 'Y') {
            this.go(1);
        } else if (e.key == 'e' || e.key == 'E') {
            this.autoPencil();
        } else if (e.key == 'r' || e.key == 'R') {
            this.recoverSnapshot();
        } else if (e.key == 's' || e.key == 'S') {
            localStorage.setItem('data', JSON.stringify(this.board.save()));
            localStorage.setItem('hist', JSON.stringify(this.operations));
            localStorage.setItem('histi', this.operationIndex.toString());
            localStorage.setItem('hists', this.snapshotIndex?.toString());
            this.board.hint('save');
        } else if (e.key == 'l' || e.key == 'L') {
            this.board.load(JSON.parse(localStorage.getItem('data') || "[]"));
            this.operations = JSON.parse(localStorage.getItem('hist') || "[]");
            this.operationIndex = parseInt(localStorage.getItem('histi') || '0');
            this.snapshotIndex = parseInt(localStorage.getItem('hists')!);
            this.board.hint('load');
        } else if (e.key == 'Escape') {
            this.board.load([]);
            this.operations = [];
            this.operationIndex = 0;
            this.board.hint('clear');
        } else if (e.key == 'q' || e.key == 'Q') {
            this.pencil = !this.pencil;
            this.board.hint(this.pencil ? 'pencil' : 'pen');
        } else if (e.key == 'Enter') {
            this.check();
        }
    }
}

const boardElement = makeBoardElement(document.querySelector('div#board-container')!);
const board = new Board();
board.bind(boardElement);
const rule = window['thegame'] = new Rule(board);

// ATTENTION temp auto load here
board.load(JSON.parse(localStorage.getItem('data') || "[]"));
rule.operations = JSON.parse(localStorage.getItem('hist') || "[]");
rule.operationIndex = parseInt(localStorage.getItem('histi') || '0');
rule.snapshotIndex = parseInt(localStorage.getItem('hists')!);
