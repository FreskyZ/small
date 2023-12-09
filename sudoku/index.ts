// tsc index.ts --target es6 --lib dom,es2020
// npx terser --ecma 2020 --compress --mangle --output index.min.js -- index.js
// deployment note: change index.css and index.js in index.html to public path

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
    // button.dark
    dark: HTMLButtonElement,
    // button.number.number-1, index start from 1, 0 is dummy
    // click to same-value this number if this number is not on board
    numbers: HTMLButtonElement[],
    // no save/load, that's auto
    // no check, only a success modal when complete
}
interface ModalElement {
    self: HTMLDivElement,
    title: HTMLDivElement,
    text: HTMLDivElement,
    fileInput: HTMLInputElement,
    cancel: HTMLButtonElement,
    ok: HTMLButtonElement,
}
interface UIElement {
    panel: PanelElement,
    reasons: HTMLDivElement,
    modal: ModalElement,
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
    const dark = document.querySelector('button.dark') as HTMLButtonElement;

    const panel = document.querySelector('div.panel') as HTMLDivElement;
    const numbers = [null as unknown as HTMLButtonElement].concat(seq.map(numberIndex => {
        const number = document.createElement('button');
        number.className = `number number-${numberIndex}`;
        number.innerText = numberIndex.toString();
        panel.appendChild(number);
        return number;
    }));
    const panelElement: PanelElement = { toggle, undo, redo, autoPencil, autoFill,
        takeSnapshot, loadSnapshot, exportButton, importButton, clear, dark, numbers };

    const reasons = document.querySelector('div.reasons') as HTMLDivElement;

    const modal = document.querySelector('div.modal') as HTMLDivElement;
    const title = document.querySelector('div.modal div.title') as HTMLDivElement;
    const text = document.querySelector('div.modal div.text') as HTMLDivElement;
    const fileInput = document.querySelector("div.modal input[type='file']") as HTMLInputElement;
    const cancel = document.querySelector('div.modal button.cancel') as HTMLButtonElement;
    const ok = document.querySelector('div.modal button.ok') as HTMLButtonElement;
    const modalElement: ModalElement = { self: modal, title, text, fileInput, cancel, ok };

    return { panel: panelElement, reasons, modal: modalElement, blocks };
}

// --------------------------------------
// region model, or data, this is serialized data, not runtime data

// [block index, cell index], start from 1
type CellId = readonly [number, number];
// this is sparse, no value and no draft cell not included
interface CellData {
    id: CellId,
    value: number,
    candidates: readonly number[],
}

// --------------------------------------
// region view model base, rule irrelavent part, connect ui and data

class Draft {
    public readonly board: Board;
    public readonly block: Block;
    public readonly cell: Cell;
    public readonly value: number;
    public constructor(board: Board, block: Block, cell: Cell, value: number, element: HTMLDivElement) {
        this.board = board;
        this.block = block;
        this.cell = cell;
        this.value = value;
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
    public readonly id: CellId; // [block index, cell index], cell index is index in block, start from 1
    public readonly coordinate: readonly [number, number];       // [row, column], coordinate in block, start from 1 to 3
    public readonly globalCoordinate: readonly [number, number]; // [row, column], coordinate in board, start from 1 to 9

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
        this.drafts = seq.map(value => new Draft(board, block, this, value, element.drafts[value]));
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

    private _value: number; // null for empty
    public get value(): number { return this._value; }
    public set value(v: number | null) { this._value = v as number; this.valueElement.innerText = v ? v.toString() : ''; }
    public get hasValue() { return !!this._value; }

    // drafts are the small number in each cell, start from 0
    public readonly drafts: readonly Draft[];
    // candidates are cell's possible values, as array of number
    public hasCandidate(value: number) { return this.drafts[value - 1].enabled; }
    public get hasAnyCandidate(): boolean { return this.drafts.some(draft => draft.enabled); }
    public get candidates(): readonly number[] { return this.drafts.filter(draft => draft.enabled).map(draft => draft.value); }

    public get data(): CellData | null {
        return !this.hasValue && !this.hasAnyCandidate ? null : { id: this.id, value: this.value, candidates: this.candidates };
    }
    // set null to clear value and candidates
    public set data(v: CellData | null) {
        if (v) {
            this.value = v.value;
            this.drafts.forEach(draft => draft.enabled = v.candidates ? v.candidates.includes(draft.value) : false);
            // compatibility fix for old field name
            if ((v as any).drafts) {
                this.drafts.forEach(draft => draft.enabled = (v as any).drafts.includes(draft.value));
            }
        } else {
            this.value = null;
            this.drafts.forEach(draft => draft.enabled = false);
        }
    }

    public isId(id: CellId) { return this.id[0] == id[0] && this.id[1] == id[1]; }
    public isSame(rhs: Cell) { return this.isId(rhs.id); }
    public isSameValue(rhs: Cell) { return !!this._value && this._value == rhs._value; }
    // exclude this
    public isSameRegion(rhs: Cell) {
        return !this.isSame(rhs) && (this.globalRow == rhs.globalRow || this.globalColumn == rhs.globalColumn || this.block.index == rhs.block.index);
    }
    // include this
    public isSameOrSameRegion(rhs: Cell) {
        return this.globalRow == rhs.globalRow || this.globalColumn == rhs.globalColumn || this.block.index == rhs.block.index;
    }

    // actually only those 2 functions will set draft on/off
    // allow undefined because those 2 functions are known to correctly only call with valid draftindex
    public draftControl(draftIndex: number | undefined, on: boolean) {
        this.drafts[draftIndex! - 1].enabled = on;
    }
    // these 2 functions do not care about operation history
    public apply(op: Operation) {
        const cell = this; // keep separated from this, in case I move this outside of Cell again
        if (op.kind == 'draft-on') {
            if (cell.hasValue) {
                throw 'invalid operation, draft on when have final value';
            } else if (cell.hasCandidate(op.value!)) {
                throw 'invalid operation, draft on duplicate';
            }
            cell.draftControl(op.value, true);
        } else if (op.kind == 'draft-off') {
            if (cell.hasValue) {
                throw 'invalid operation, draft off when have final value';
            } else if (!cell.hasCandidate(op.value!)) {
                throw 'invalid operation, draft off when not exist';
            }
            cell.draftControl(op.value, false);
        } else if (op.kind == 'set-value') {
            op.oldValue = cell.value;
            op.oldCandidates = this.candidates;
            op.otherCells = [];
            this.board.cells.filter(other => cell.isSameRegion(other) && other.hasCandidate(op.value!)).forEach(other => {
                other.draftControl(op.value, false);
                op.otherCells?.push(other.id);
            });
            cell.drafts.forEach(draft => draft.enabled = false);
            cell.value = op.value!;
        } else if (op.kind == 'clear-value') {
            if (!cell.hasValue) {
                throw 'invalid operation, clear final value when not have final value';
            }
            op.oldValue = cell.value;
            cell.value = null;
        } else if (op.kind == 'auto-pencil') {
            op.otherCells ??= [];
            if (!cell.hasValue && !cell.hasAnyCandidate) {
                const values = this.board.cells
                    .filter(other => cell.isSameRegion(other) && other.hasValue).map(other => other.value);
                for (const value of seq.filter(v => !values.includes(v))) {
                    cell.draftControl(value, true);
                }
                op.otherCells?.push(cell.id);
            }
        }
    }
    public reverseApply(op: Operation) {
        const cell = this;
        if (op.kind == 'draft-on') {
            if (cell.hasValue) {
                throw 'invalid reverse operation, cannot reverse draft on when have final value'
            } else if (!cell.hasCandidate(op.value!)) {
                throw 'invalid reverse opration, cannot reverse draft on when that is not on';
            }
            cell.draftControl(op.value, false);
        } else if (op.kind == 'draft-off') {
            if (cell.hasValue) {
                throw 'invalid reverse operation, cannot reverse draft off when have final value'
            } else if (cell.hasCandidate(op.value!)) {
                throw 'invalid reverse opration, cannot reverse draft off when that is not off';
            }
            cell.draftControl(op.value, true);
        } else if (op.kind == 'set-value') {
            cell.value = op.oldValue!;
            op.oldCandidates?.forEach(candidate => cell.draftControl(candidate, true));
            op.otherCells?.forEach(id => this.board.byId(id).draftControl(op.value, true));
        } else if (op.kind == 'clear-value') {
            if (cell.hasValue) {
                throw 'invalid operation, cannot reverse clear final value when have final value';
            }
            cell.value = op.oldValue!;
        } else if (op.kind == 'auto-pencil') {
            if (op.otherCells?.some(id => cell.isId(id))) {
                cell.drafts.forEach(draft => draft.enabled = false);
            }
        }
    }
}

class Block {
    public readonly board: Board;
    public readonly element: BlockElement;
    public readonly index: number;
    public readonly row: number;
    public readonly column: number;
    public readonly cells: readonly Cell[]; // start from 0

    public constructor(board: Board, index: number, element: BlockElement) {
        this.board = board;
        this.element = null as unknown as BlockElement;
        this.index = index;
        [this.row, this.column] = indexToRowColumn(index);
        this.cells = seq.map(cellIndex => new Cell(board, this, cellIndex, element.cells[cellIndex]));
    }
}

class Board {
    // start from 0
    public readonly blocks: readonly Block[];
    // start from 0, contain exactly the 81 cells, not this.blocks.flatmap(block.cells)
    // the order is not specified, although it is currently implemented by id (block index then cell index)
    public readonly cells: readonly Cell[]; 
    
    public constructor(element: UIElement) {
        this.blocks = seq.map(blockIndex => new Block(this, blockIndex, element.blocks[blockIndex]));
        this.cells = seq.flatMap(blockIndex => seq.map(cellIndex => this.byId([blockIndex, cellIndex])));
    }

    public getCellData(): CellData[] {
        // amazingly typescript cannot Array<CellData | null>.filter(x => x): Array<CellData>
        return this.cells.map<CellData>(cell => cell.data!).filter(x => x);
    }
    public setCellData(cellDatas: CellData[]) {
        this.cells.forEach(cell => cell.data = null);
        cellDatas.forEach(data => this.byId(data.id).data = data);
    }

    // get block by block index
    public byBlockIndex(blockIndex: number): Block {
        return this.blocks[blockIndex - 1];
    }
    // get cell by id
    public byId(id: CellId): Cell {
        return this.blocks[id[0] - 1].cells[id[1] - 1];
    }
    // get cells by global row
    public byGlobalRow(globalRow: number): Cell[] {
        return this.cells.filter(cell => cell.globalRow == globalRow);
    }
    // get cells by global column
    public byGlobalColumn(globalColumn: number): Cell[] {
        return this.cells.filter(cell => cell.globalColumn == globalColumn);
    }
    // get cell by global coordinate, global row and global column start from 1
    public byGlobalCoordinate([globalRow, globalColumn]: [number, number]): Cell {
        return this.blocks[
            // block's row = Math.floor((boardRow - 1) / 3) + 1
            // block's column = Math.floor((boardColumn - 1) / 3) + 1
            Math.floor((globalRow - 1) / 3) * 3 + Math.floor((globalColumn - 1) / 3)
        ].cells[
            // cell's row = (boardRow - 1) % 3 + 1;
            // cell's column = (boardColumn - 1) % 3 + 1;
            (globalRow - 1) % 3 * 3 + (globalColumn - 1) % 3
        ];
    }

    public forEachRegion(callback: (cells: Cell[], regionName: string) => any) {
        for (const globalRow of seq) {
            const cells = seq.map(globalColumn => this.byGlobalCoordinate([globalRow, globalColumn]));
            callback(cells, `row ${globalRow}`);
        }
        for (const globalColumn of seq) {
            const cells = seq.map(globalRow => this.byGlobalCoordinate([globalRow, globalColumn]));
            callback(cells, `column ${globalColumn}`);
        }
        this.blocks.map(block => callback(block.cells.map(x => x), `block ${block.row},${block.column}`));
    }

    public isComplete() {
        if (this.cells.some(cell => !cell.hasValue)) {
            return false;
        }
        let ok = true;
        this.forEachRegion((cells, _) => {
            ok &&= !cells.map(cell => cell.value).sort((a, b) => a - b).some((v, i) => v != i + 1);
        });
        return true;
    }
}

// this is not data, but do wraps ui element
class Modal {
    public readonly element: ModalElement;
    public constructor(element: UIElement) {
        this.element = element.modal;
        this.element.cancel.addEventListener('click', () => this.hide());
    }

    public set title(title: string) {
        this.element.title.innerText = title;
    }
    public set text(text: string) {
        this.element.text.innerText = text;
    }
    public set inputVisible(on: boolean) {
        classControl(this.element.fileInput, 'visible', on);
    }
    public show() {
        classControl(this.element.self, 'visible', true);
    }
    public hide() {
        if (this.changeHandler) {
            this.element.fileInput.removeEventListener('change', this.changeHandler);
            this.changeHandler = null;
        }
        if (this.okHandler) {
            this.element.ok.removeEventListener('click', this.okHandler);
            this.okHandler = null;
        }
        this.element.fileInput.value = '';
        classControl(this.element.self, 'visible', false);
    }

    private changeHandler: ((e: Event) => void) | null = null;
    public handleFileChange(handler: (e: Event) => void): () => void {
        this.changeHandler = handler;
        this.element.fileInput.addEventListener('change', handler);
        return () => {
            this.changeHandler = null;
            this.element.fileInput.removeEventListener('change', handler);
        };
    }
    private okHandler: ((e: MouseEvent) => void) | null = null;
    public handleOk(handler: (e: MouseEvent) => void): () => void {
        this.okHandler = handler;
        this.element.ok.addEventListener('click', handler);
        return () => {
            this.okHandler = null;
            this.element.ok.removeEventListener('click', handler);
        };
    }
}

// ----------------------------------------
// region user interactive, here handles rule

type Operation = {
    kind: 'draft-on',
    id: CellId,
    value: number,
} | {
    kind: 'draft-off',
    id: CellId,
    value: number,
} | {
    kind: 'set-value',
    id: CellId,
    value: number,
    // old value, null for originally no value,
    // specify |null will only add meaningless ! so not 
    oldValue: number,
    // old draft values in this cell
    oldCandidates: readonly number[],
    // other same region cells with same value candidate
    otherCells: CellId[],
} | {
    kind: 'clear-value',
    id: CellId,
    oldValue: number,
} | {
    kind: 'auto-pencil',
    // not used, but put here to make id eaiser to access
    id: CellId,
    // auto pencil changed cells
    otherCells: CellId[],
}
// don't require specify those mutable and for-reverse parts when calling do
type OperationInit = {
    kind: 'draft-on',
    id: CellId,
    value: number,
} | {
    kind: 'draft-off',
    id: CellId,
    value: number,
} | {
    kind: 'set-value',
    id: CellId,
    value: number,
} | {
    kind: 'clear-value',
    id: CellId,
} | {
    kind: 'auto-pencil',
}

class Behavior {
    public readonly board: Board;
    public readonly modal: Modal;
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
    // dark theme
    private dark: boolean;
    // previously active cell for touch device, not work for mouse device
    private previouslyActiveCell: Cell | null;

    public constructor(board: Board, modal: Modal, element: UIElement) {
        this.board = board;
        this.modal = modal;
        this.element = element.panel;
        this.operations = [null as unknown as Operation];
        this.operationIndex = 1;
        this.snapshotIndex = 0;
        this.isPencil = false;
        this.externalActiveNumber = 0;
        this.reportedComplete = false;
        this.previouslyActiveCell = null;
    
        const savedatastring = localStorage.getItem('PAGEDATA');
        if (savedatastring) {
            const savedata = JSON.parse(savedatastring);
            this.board.setCellData(savedata.cellData);
            // compatibility fix for old field name
            this.operations = savedata.operations.map((op: any) => { if (op) { op.oldCandidates = op.oldCandidates || op.oldDrafts; } return op; });
            this.operationIndex = savedata.operationIndex;
            this.snapshotIndex = savedata.snapshotIndex;
            this.isPencil = savedata.isPencil;
            this.dark = savedata.dark;
        }

        this.board.cells.forEach(cell => {
            cell.cellElement.addEventListener('focus', () => this.update());
            cell.cellElement.addEventListener('blur', () => { this.previouslyActiveCell = cell; this.update(); });
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
        this.element.dark.addEventListener('click', this.handleToggleTheme);
        seq.forEach(n => this.element.numbers[n].addEventListener('pointerdown', e => this.handleNumberInput(n, e)));

        this.update();
    }

    // similar to the per frame handler in real time game,
    // this is called every time game is interacted to update related state
    private update() {

        // same region hint and same value hint
        this.board.cells.forEach(cell => {
            cell.style('same-region-hint', false);
            cell.style('same-value-hint', false);
            cell.drafts.forEach(draft => draft.style('same-value-hint', false));
        })
        const activeCell = this.board.cells.find(cell => cell.isFocused())
            // TODO this make externactivenumber's external part not working, may need a button for that
            || (navigator['userAgentData']?.mobile ? this.previouslyActiveCell : null);
        if (activeCell) {
            this.externalActiveNumber = 0;
            this.board.cells.forEach(other => {
                // don't forget to off not meet condition cells
                const sameRegion = activeCell.isSameOrSameRegion(other);
                const sameValue = activeCell.isSameValue(other);
                other.style('same-region-hint', sameRegion);
                other.style('same-value-hint', !sameRegion && sameValue);
                other.drafts.forEach(draft => {
                    draft.style('same-value-hint', draft.enabled && !sameRegion && activeCell.hasValue && draft.value == activeCell.value);
                });
            });
        } else {
            this.board.cells.forEach(cell => {
                cell.style('same-value-hint', cell.value == this.externalActiveNumber);
                cell.drafts.forEach(draft => {
                    draft.style('same-value-hint', draft.enabled && draft.value == this.externalActiveNumber);
                });
            });
        }

        // duplicate hint
        this.board.cells.forEach(cell => {
            cell.style('duplicate-hint', false);
            cell.drafts.forEach(draft => draft.style('duplicate-hint', false));
        });
        this.board.forEachRegion((cells, _) => {
            cells.forEach(lhs => cells.filter(rhs => !lhs.isSame(rhs)).forEach(rhs => {
                if (lhs.isSameValue(rhs)) {
                    lhs.style('duplicate-hint', true);
                    rhs.style('duplicate-hint', true);
                }
                rhs.drafts.filter(draft => draft.enabled && lhs.hasValue && draft.value == lhs.value).forEach(draft => {
                    draft.style('duplicate-hint', true);
                });
                lhs.drafts.filter(draft => draft.enabled && rhs.hasValue && draft.value == rhs.value).forEach(draft => {
                    draft.style('duplicate-hint', true);
                });
            }));
        });

        // panel style
        classControl(document.body, 'dark', this.dark);
        classControl(this.element.toggle, 'pen', !this.isPencil);
        classControl(this.element.toggle, 'pencil', this.isPencil);
        this.element.undo.disabled = this.operationIndex <= 1;
        this.element.redo.disabled = this.operations.length <= this.operationIndex || this.operations[this.operationIndex] == null;
        this.element.loadSnapshot.disabled = !this.snapshotIndex || this.operations[this.snapshotIndex] == null;
        seq.forEach(numberIndex => {
            const disabled = this.board.cells.filter(cell => cell.value == numberIndex).length == 9;
            this.element.numbers[numberIndex].disabled = disabled;
            if (disabled && this.externalActiveNumber == numberIndex) {
                this.externalActiveNumber = 0;
            }
        });
        
        seq.forEach(numberIndex => classControl(this.element.numbers[numberIndex], 'active', this.externalActiveNumber == numberIndex));

        // complete!
        if (!this.reportedComplete && this.board.isComplete()) {
            this.modal.title = 'completed!';
            this.modal.inputVisible = false;
            const removeOkHandler = this.modal.handleOk(() => {
                removeOkHandler();
                this.modal.hide();
            });
            this.modal.show();
            this.reportedComplete = true;
        }
        
        // save data to local storage
        localStorage.setItem('PAGEDATA', JSON.stringify({
            cellData: this.board.getCellData(),
            operations: this.operations,
            operationIndex: this.operationIndex,
            snapshotIndex: this.snapshotIndex,
            isPencil: this.isPencil,
            dark: this.dark,
        }));
    }

    // only these 2 functions alternate operation history
    public do(init: OperationInit) {
        const op = init as Operation;
        if (this.operations.length == this.operationIndex) {
            this.operations.push(op);
        } else {
            this.operations[this.operationIndex] = op;
            for (let index = this.operationIndex + 1; index < this.operations.length; index += 1) {
                this.operations[index] = null as unknown as Operation;
            }
        }
        if (op.kind == 'auto-pencil') {
            this.board.cells.forEach(cell => cell.apply(op));
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
                    this.board.cells.forEach(cell => cell.reverseApply(op));
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
                    this.board.cells.forEach(cell => cell.apply(op));
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
        this.do({ kind: 'auto-pencil' });
    }

    private inferrer: InferrerLike;
    public setInferrer(inferer: InferrerLike) {
        this.inferrer = inferer;
    }
    private handleAutoFill = () => {
        this.inferrer.infer(false);
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

    // keyboard number click or number button click
    public handleNumberInput = (value: number, e?: PointerEvent) => {
        const cell = this.board.cells.find(cell => cell.isFocused())
            || (e?.pointerType == 'touch' ? this.previouslyActiveCell : null);
        if (cell) {
            if (this.isPencil && !cell.hasValue) {
                if (cell.hasCandidate(value)) {
                    this.do({ id: cell.id, kind: 'draft-off', value });
                } else {
                    this.do({ id: cell.id, kind: 'draft-on', value });
                }
            } else if (!this.isPencil && cell.value != value) {
                this.do({ id: cell.id, kind: 'set-value', value });
            }
            // if cell lost focus because of click number button, focus back
            if (!cell.isFocused()) {
                cell.focus();
            }
        } else {
            // pretend nothing if that number is not available
            if (this.element.numbers[value].disabled = this.board.cells.filter(cell => cell.value == value).length == 9) {
                return;
            }
            if (this.externalActiveNumber != value) {
                this.externalActiveNumber = value;
            } else {
                this.externalActiveNumber = 0;
            }
            this.update();
        }
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

    private handleExport = () => {
        const data = JSON.stringify({
            cellData: this.board.getCellData(),
            operations: this.operations,
            operationIndex: this.operationIndex,
        });
        const a = document.createElement('a');
        a.setAttribute('href', 'data:text/plain;charset=utf8,' + encodeURIComponent(data));
        a.setAttribute('download', 'sudoku.json');
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
    private handleImport = () => {
        let data: { cellData: CellData[], operations: Operation[], operationIndex: number } | null = null;
        this.modal.title = 'Import';
        this.modal.text = '';
        this.modal.inputVisible = true;
        const removeNothingOkHandler = this.modal.handleOk(() => {
            removeNothingOkHandler();
            this.modal.hide();
        });
        const removeChangeHandler = this.modal.handleFileChange(e => {
            if (this.modal.element.fileInput.files && this.modal.element.fileInput.files.length) {
                let file = this.modal.element.fileInput.files[0];
                let reader = new FileReader();
                reader.onload = e => {
                    try {
                        data = JSON.parse(reader.result as string);
                        removeChangeHandler();
                        removeNothingOkHandler();
                        const removeOkHandler = this.modal.handleOk(() => {
                            this.board.setCellData(data!.cellData);
                            this.operations.splice(0, this.operations.length);
                            // compatibility fix for old field name
                            this.operations.push(...data!.operations.map((op: any) => { if (op) { op.oldCandidates = op.oldCandidates || op.oldDrafts; } return op; }));
                            this.operationIndex = data!.operationIndex;
                            this.snapshotIndex = 0;
                            this.reportedComplete = false;
                            removeOkHandler();
                            this.modal.hide();
                            this.update();
                        });
                    } catch {
                        this.modal.text = 'unrecognized file content';
                    }
                };
                reader.onerror = () => {
                    this.modal.text = 'failed to read file content';
                };
                reader.readAsText(file);
            }
        });
        this.modal.show();
    }
    
    private handleToggleTheme = () => {
        this.dark = !this.dark;
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
            return;
        } else if (e.key == 'y' || e.key == 'Y') {
            if (this.operations.length > this.operationIndex && this.operations[this.operationIndex] != null) {
                this.go(1);
            }
            e.stopPropagation();
            return;
        } else if (e.key == 'r' || e.key == 'R') {
            if (this.snapshotIndex && this.operations[this.snapshotIndex] != null) {
                this.go(this.snapshotIndex - this.operationIndex);
            }
            e.stopPropagation();
            return;
        } else if (e.key == 'q' || e.key == 'Q') {
            this.inferrer.infer(true);
            e.stopPropagation();
        } else if (e.key == 'v' && e.ctrlKey) {
            // text sharing format from sudoku.coach
            // \d{81} as in globalrow from 1 to 9 then globalcolumn from 1 to 9 order
            navigator.clipboard.readText().then(text => {
                if (/^\d{81}$/.test(text) && confirm(`paste sudoku.coach text sharing format ${text}?`)) {
                    let cellData: CellData[] = [];
                    for (const globalRow of seq) {
                        for (const globalColumn of seq) {
                            const value = parseInt(text.charAt((globalRow - 1) * 9 + globalColumn - 1));
                            if (value) {
                                cellData.push({ id: this.board.byGlobalCoordinate([globalRow, globalColumn]).id, value, candidates: [] });
                            }
                        }
                    }
                    this.board.setCellData(cellData);
                    this.operations.splice(0, this.operations.length);
                    // compatibility fix for old field name
                    this.operations.push(null as unknown as Operation);
                    this.operationIndex = 1;
                    this.snapshotIndex = 0;
                    this.reportedComplete = false;
                    this.update();
                }
            });
            e.stopPropagation();
        } else if (e.key == 'ArrowLeft' && cell != null) {
            if (cell.globalColumn > 1) {
                this.board.byGlobalCoordinate([cell.globalRow, cell.globalColumn - 1]).focus();
            }
        } else if (e.key == 'ArrowRight' && cell != null) {
            if (cell.globalColumn < 9) {
                this.board.byGlobalCoordinate([cell.globalRow, cell.globalColumn + 1]).focus();
            }
        } else if (e.key == 'ArrowUp' && cell != null) {
            if (cell.globalRow > 1) {
                this.board.byGlobalCoordinate([cell.globalRow - 1, cell.globalColumn]).focus();
            }
        } else if (e.key == 'ArrowDown' && cell != null) {
            if (cell.globalRow < 9) {
                this.board.byGlobalCoordinate([cell.globalRow + 1, cell.globalColumn]).focus();
            }
        } else if ((e.key == 'Backspace' || e.key == 'Delete') && cell != null) {
            if (cell.hasValue) {
                this.do({ id: cell.id, kind: 'clear-value' });
            }
        } else if (['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(e.key)) {
            this.handleNumberInput(parseInt(e.key));
            e.stopPropagation();
            return;
        }
        this.update();
    }
}

interface InferrerLike {
    infer: (apply: boolean) => void;
}

type ReasonSegment = {
    kind: 'text',
    text: string,
} | {
    kind: 'cell-id',
    id: CellId,
} | {
    kind: 'number',
    value: number,
}

class Inferrer {
    public readonly behavior: Behavior;
    public readonly board: Board;
    public readonly element: HTMLDivElement;
    public constructor(behavior: Behavior, element: UIElement) {
        this.behavior = behavior;
        this.board = behavior.board;
        this.element = element.reasons;
    }

    private reason(segments: ReasonSegment[], operations: OperationInit[]) {
        const reason = document.createElement('div');
        reason.className = 'reason';
        this.element.appendChild(reason);
        reason.scrollIntoView({ behavior: 'smooth' });
        for (const segment of segments) {
            if (segment.kind == 'text') {
                const text = document.createElement('span');
                text.className = 'text';
                text.innerText = segment.text;
                reason.appendChild(text);
            } else if (segment.kind == 'cell-id') {
                const cellId = document.createElement('span');
                cellId.className = 'cell-id';
                const cell = this.board.byId(segment.id);
                cellId.innerText = cell.globalCoordinate.join(',');
                cellId.addEventListener('click', () => {
                    this.board.byId(segment.id).focus();
                });
                reason.appendChild(cellId);
            } else if (segment.kind == 'number') {
                const number = document.createElement('span');
                number.className = 'number';
                number.innerText = segment.value.toString();
                number.addEventListener('click', () => {
                    if (seq.includes(segment.value)) {
                        this.behavior.handleNumberInput(segment.value);
                    }
                });
                reason.appendChild(number);
            }
        }
        if (this.apply) {
            for (const op of operations) {
                if (op.kind == 'auto-pencil') {
                    this.behavior.do(op);
                } else if (op.kind == 'set-value') {
                    if (this.board.byId(op.id).value != op.value) {
                        this.behavior.do(op);
                    }
                } else if (op.kind == 'draft-off') {
                    if (this.board.byId(op.id).hasCandidate(op.value!)) {
                        this.behavior.do(op);
                    }
                } else {
                    throw 'invalid reason op kind';
                }
            }
        }
    }

    private apply: boolean;
    public infer = (apply: boolean) => {
        this.apply = apply;
        this.element.innerHTML = '';
        if (![
            this.basicValidation,
            this.autoPencil,
            this.singleCandidate,
            this.singleOccurenceInRegion,
            this.subregion,
            this.blockRowOrColumn,
            this.x,
            this.simpleSameRegionCircle,
        ].find(x => x())) {
            this.reason([{ kind: 'text', text: 'nothing for now ' }], []);
        }
    }

    private basicValidation = () => {
        // note this ok means not ok in this function
        // because other functions use ok to disable following strategies,
        // this function use ok to indicate basic error and should not go forward
        let ok = false;
        // duplicate value in region
        this.board.forEachRegion((cells, regionName) => {
            if (cells.filter(cell => cell.hasValue).map(cell => cell.value).some((v, i, a) => a.indexOf(v) != i)) {
                ok = true;
                this.reason([
                    { kind: 'text', text: `basic-validation: ${regionName} have duplicate values` },
                ], []);
            }
        });
        // no candidate
        this.board.cells.filter(cell => !cell.hasValue).forEach(cell => {
            // also validate the cell regardless of current draft state
            const existValues = this.board.cells.filter(other => cell.isSameRegion(other) && other.hasValue).map(other => other.value);
            const possibleValues = seq.filter(v => !existValues.includes(v));
            if (possibleValues.length == 0) {
                ok = true;
                this.reason([
                    { kind: 'text', text: 'basic-validation: cell ' },
                    { kind: 'cell-id', id: cell.id },
                    { kind: 'text', text: ' is already incorrect with no possible values' },
                ], []);
            }
        });
        return ok;
    }
    private autoPencil = () => {
        let ok = false;
        if (this.board.cells.some(cell => !cell.hasValue && !cell.hasAnyCandidate)) {
            ok = true;
            this.reason([
                { kind: 'text', text: 'basic: some cells are still empty' },
            ], [
                { kind: 'auto-pencil' },
            ]);
        }
        return ok;
    }

    private singleCandidate = () => {
        let ok = false;
        this.board.cells.filter(cell => !cell.hasValue && cell.candidates.length == 1).forEach(cell => {
            ok = true;
            // cannot inline this, if some error happens,
            // cell.draftvalues may become empty after previous applies in same batch
            const value = cell.candidates[0];
            this.reason([
                { kind: 'text', text: 'single-candidate: cell ' },
                { kind: 'cell-id', id: cell.id },
                { kind: 'text', text: ' value ' },
                { kind: 'number', value },
            ], [
                { kind: 'set-value', id: cell.id, value },
            ]);
        });
        return ok;
    }

    // single occurence in different types of region, this works on existing draft
    private singleOccurenceInRegion = () => {
        let ok = false;
        const okedCells: CellId[] = []; 

        this.board.forEachRegion((cells, regionName) => {
            for (const attempt of seq) {
                const occurence = cells.filter(cell => !cell.hasValue && cell.hasCandidate(attempt));
                if (occurence.length == 1) {
                    if (okedCells.some(id => occurence[0].isId(id))) {
                        continue;
                    }
                    okedCells.push(occurence[0].id);
                    ok = true;
                    this.reason([
                        { kind: 'text', text: 'single-occur: cell ' },
                        { kind: 'cell-id', id: occurence[0].id },
                        { kind: 'text', text: ' is ' },
                        { kind: 'number', value: attempt },
                        { kind: 'text', text: ` because it is occurred only once in ${regionName}` },
                    ], [
                        { kind: 'set-value', id: occurence[0].id, value: attempt },
                    ]);
                }
            }
        });
        return ok;
    }

    // for each region, if N cells only have N numbers,
    // e.g. 2 cells with 2,4 and 2,4
    // e.g. 3 cells with 2,3; 2,4 and 3,4
    // then other cells should not have these number
    private subregion = () => {
        let ok = false;

        this.board.forEachRegion((cells, regionName) => {
            // only care about drafted cells
            cells = cells.filter(cell => !cell.hasValue);
            // not work for remaining 2 cells
            if (cells.length <= 2) {
                return;
            }
            // 0x1, 0x10 is not 2 items, exclude all selected
            for (let b = 3; b < (1 << cells.length) - 1; b += 1) {
                const x = b.toString(2).padStart(cells.length, '0');
                const selection = new Array(x.length).fill(0).map((_, i) => x[i] == '1' ? cells[i] : null).filter(x => x) as unknown as Cell[];
                if (selection.length <= 1) {
                    continue;
                }
                const candidateset = new Set(selection.flatMap(cell => cell.candidates));
                if (candidateset.size != selection.length) {
                    continue; // most normal case
                }
                
                const allCandidates = Array.from(candidateset);
                const otherCells = cells.filter(cell => !selection.some(selection => selection.isSame(cell)));
                const operations: Operation[] = [];
                for (const otherCell of otherCells) {
                    for (const attempt of allCandidates) {
                        if (otherCell.hasCandidate(attempt)) {
                            operations.push({ kind: 'draft-off', id: otherCell.id, value: attempt });
                        }
                    }
                }

                if (operations.length == 0) {
                    continue; // other cells already cleared
                }
                ok = true;
                const segments: ReasonSegment[] = [
                    { kind: 'text', text: 'subregion: cells ' },
                ];
                for (const cell of selection) {
                    segments.push({ kind: 'cell-id', id: cell.id });
                    segments.push({ kind: 'text', text: ';' });
                }
                segments.pop();
                segments.push({ kind: 'text', text: ' only contains ' });
                for (const value of candidateset) {
                    segments.push({ kind: 'number', value });
                    segments.push({ kind: 'text', text: ',' });
                }
                segments.push({ kind: 'text', text: ` so other cells in ${regionName} can remove these values` });
                this.reason(segments, operations);
            }
        });
        return ok;
    }

    // if a specific value only appears in one row/column inside one block,
    // if this value does not appear in the same row/column outside of the block,
    // then other cell in same block should not have the value,
    // or if this value does not appear in other cell in the same block,
    // then other cell in same row/column outside of the block cannot have the value
    private blockRowOrColumn = () => {
        let ok = false;

        for (const block of this.board.blocks) {
            for (const row of [1, 2, 3]) {
                // both in block and in row cells
                const blockRowCells = block.cells.filter(cell => !cell.hasValue && cell.row == row);
                if (blockRowCells.length < 2) {
                    continue;
                }
                const multipleOccurenceCandidates = seq.filter(value => blockRowCells.filter(cell => cell.hasCandidate(value)).length > 1);
                if (multipleOccurenceCandidates.length == 0) {
                    continue;
                }
                const blockOtherCells = block.cells.filter(cell => !cell.hasValue && cell.row != row);
                const rowOtherCells = this.board.cells
                    .filter(cell => !cell.hasValue && cell.globalRow == blockRowCells[0].globalRow && cell.block.index != block.index);
                if (blockOtherCells.length == 0 && rowOtherCells.length == 0) {
                    continue;
                }
                for (const attempt of multipleOccurenceCandidates) {
                    // if block other cells does not have the candidate, then row other cells cannot have the candidate
                    if (!blockOtherCells.some(cell => cell.hasCandidate(attempt))) {
                        const rowOtherCellsWithThisValue = rowOtherCells.filter(cell => cell.hasCandidate(attempt));
                        if (rowOtherCellsWithThisValue.length == 0) {
                            continue;
                        }
                        ok = true;
                        const segments: ReasonSegment[] = [
                            { kind: 'text', text: 'block-row: value ' },
                            { kind: 'number', value: attempt },
                            { kind: 'text', text: ' only exist in cells ' },
                        ];
                        for (const cell of blockRowCells) {
                            segments.push({ kind: 'cell-id', id: cell.id });
                            segments.push({ kind: 'text', text: ';' });
                        }
                        segments.pop();
                        segments.push({ kind: 'text', text: ` in row ${blockRowCells[0].globalRow
                            } and not in other cells in block ${block.row},${block.column
                            }, so it cannot exist in other cells in the row outside of the block` });
                        const operations = rowOtherCellsWithThisValue
                            .map<OperationInit>(cell => ({ kind: 'draft-off', id: cell.id, value: attempt }));
                        this.reason(segments, operations);
                    } else if (!rowOtherCells.some(cell => cell.hasCandidate(attempt))) {
                        const blockOtherCellsWithThisValue = blockOtherCells.filter(cell => cell.hasCandidate(attempt));
                        if (blockOtherCellsWithThisValue.length == 0) {
                            continue;
                        }
                        ok = true;
                        const segments: ReasonSegment[] = [
                            { kind: 'text', text: 'block-row: value ' },
                            { kind: 'number', value: attempt },
                            { kind: 'text', text: ' only exist in cells ' },
                        ];
                        for (const cell of blockRowCells) {
                            segments.push({ kind: 'cell-id', id: cell.id });
                            segments.push({ kind: 'text', text: ';' });
                        }
                        segments.pop();
                        segments.push({ kind: 'text', text: ` in block ${block.row},${block.column
                            } and not in other cells in row ${blockRowCells[0].globalRow
                            }, so it cannot exist in other cells in the block outside of this row` });
                        const operations = blockOtherCellsWithThisValue
                            .map<OperationInit>(cell => ({ kind: 'draft-off', id: cell.id, value: attempt }));
                        this.reason(segments, operations);
                    }
                }
            }
            // row/column part looks really like but cannot merge for now
            for (const column of [1, 2, 3]) {
                // both in block and column cells
                const blockColumnCells = block.cells.filter(cell => !cell.hasValue && cell.column == column);
                if (blockColumnCells.length < 2) {
                    continue;
                }
                const multipleOccurenceCandidates = seq.filter(value => blockColumnCells.filter(cell => cell.hasCandidate(value)).length > 1);
                if (multipleOccurenceCandidates.length == 0) {
                    continue;
                }
                const blockOtherCells = block.cells.filter(cell => !cell.hasValue && cell.column != column);
                const columnOtherCells = this.board.cells
                    .filter(cell => !cell.hasValue && cell.globalColumn == blockColumnCells[0].globalColumn && cell.block.index != block.index);
                if (blockOtherCells.length == 0 && columnOtherCells.length == 0) {
                    continue;
                }
                for (const attempt of multipleOccurenceCandidates) {
                    if (!blockOtherCells.some(cell => cell.hasCandidate(attempt))) {
                        const ColumnOtherCellsWithThisValue = columnOtherCells.filter(cell => cell.hasCandidate(attempt));
                        if (ColumnOtherCellsWithThisValue.length == 0) {
                            continue;
                        }
                        ok = true;
                        const segments: ReasonSegment[] = [
                            { kind: 'text', text: 'block-column: value ' },
                            { kind: 'number', value: attempt },
                            { kind: 'text', text: ' only exist in cells ' },
                        ];
                        for (const cell of blockColumnCells) {
                            segments.push({ kind: 'cell-id', id: cell.id });
                            segments.push({ kind: 'text', text: ';' });
                        }
                        segments.pop();
                        segments.push({ kind: 'text', text: ` in column ${blockColumnCells[0].globalColumn
                            } and not in other cells in block ${block.row},${block.column
                            }, so it cannot exist in other cells in the column outside of the block` });
                        const operations = ColumnOtherCellsWithThisValue
                            .map<OperationInit>(cell => ({ kind: 'draft-off', id: cell.id, value: attempt }));
                        this.reason(segments, operations);
                    } else if (!columnOtherCells.some(cell => cell.hasCandidate(attempt))) {
                        const blockOtherCellsWithThisValue = blockOtherCells.filter(cell => cell.hasCandidate(attempt));
                        if (blockOtherCellsWithThisValue.length == 0) {
                            continue;
                        }
                        ok = true;
                        const segments: ReasonSegment[] = [
                            { kind: 'text', text: 'block-column: value ' },
                            { kind: 'number', value: attempt },
                            { kind: 'text', text: ' only exist in cells ' },
                        ];
                        for (const cell of blockColumnCells) {
                            segments.push({ kind: 'cell-id', id: cell.id });
                            segments.push({ kind: 'text', text: ';' });
                        }
                        segments.pop();
                        segments.push({ kind: 'text', text: ` in block ${block.row},${block.column
                            } and not in other cells in column ${blockColumnCells[0].globalColumn
                            }, so it cannot exist in other cells in the block outside of this column` });
                            const operations = blockOtherCellsWithThisValue
                                .map<OperationInit>(cell => ({ kind: 'draft-off', id: cell.id, value: attempt }));
                        this.reason(segments, operations);
                    }
                }
            }
        }

        return ok;
    }

    // if 2 rows/columns both only have 2 occurence of one value and that 2 ocurrence is same column/rows
    // then the value must be in that 2 columns/rows, so other cells in the same columns/rows cannot have the value
    // this is called x because the 4 cells only have 2 possiblities which are both diagnally, after connected they look like x
    private x = () => {
        let ok = false;

        for (const row1 of seq) {
            for (const row2 of seq.filter(r => r > row1)) {
                for (const attempt of seq) {
                    const row1Cells = this.board.byGlobalRow(row1).filter(cell => cell.hasCandidate(attempt));
                    const row2Cells = this.board.byGlobalRow(row2).filter(cell => cell.hasCandidate(attempt));
                    if (row1Cells.length != 2 || row2Cells.length != 2) {
                        continue;
                    }
                    if (row1Cells[0].globalColumn != row2Cells[0].globalColumn || (row1Cells[1].globalColumn != row2Cells[1].globalColumn)) {
                        continue;
                    }
                    for (const [column, thecells] of [
                        [row1Cells[0].globalColumn, [row1Cells[0], row2Cells[0]]],
                        [row1Cells[1].globalColumn, [row1Cells[1], row2Cells[1]]],
                    ] as [number, [Cell, Cell]][]) {
                        const otherHaveCandidateCells = this.board.byGlobalColumn(column)
                            .filter(cell => cell.globalRow != row1 && cell.globalRow != row2 && cell.hasCandidate(attempt));
                        if (otherHaveCandidateCells.length > 0) {
                            ok = true;
                            const segments: ReasonSegment[] = [
                                { kind: 'text', text: 'x: cells ' },
                            ];
                            for (const cell of otherHaveCandidateCells) {
                                segments.push({ kind: 'cell-id', id: cell.id });
                                segments.push({ kind: 'text', text: ';' })
                            }
                            segments.pop();
                            segments.push({ kind: 'text', text: ' cannot have ' });
                            segments.push({ kind: 'number', value: attempt });
                            segments.push({ kind: 'text', text: ' because this value must be in ' });
                            segments.push({ kind: 'cell-id', id: thecells[0].id });
                            segments.push({ kind: 'text', text: ' or ' });
                            segments.push({ kind: 'cell-id', id: thecells[1].id });
                            segments.push({ kind: 'text', text: ` because there are both only 2 occurence of this value in row ${row1
                                } and row ${row2} and they are both in column ${row1Cells[0].globalColumn} and column ${row1Cells[1].globalColumn}` });
                            this.reason(segments, otherHaveCandidateCells.map(cell => ({ kind: 'draft-off', id: cell.id, value: attempt })));
                        }
                    }
                }
            }
        }

        for (const column1 of seq) {
            for (const column2 of seq.filter(r => r > column1)) {
                for (const attempt of seq) {
                    const column1Cells = this.board.byGlobalColumn(column1).filter(cell => cell.hasCandidate(attempt));
                    const column2Cells = this.board.byGlobalColumn(column2).filter(cell => cell.hasCandidate(attempt));
                    if (column1Cells.length != 2 || column2Cells.length != 2) {
                        continue;
                    }
                    if (column1Cells[0].globalRow != column2Cells[0].globalRow || (column1Cells[1].globalRow != column2Cells[1].globalRow)) {
                        continue;
                    }
                    for (const [row, thecells] of [
                        [column1Cells[0].globalRow, [column1Cells[0], column2Cells[0]]],
                        [column1Cells[1].globalRow, [column1Cells[1], column2Cells[1]]],
                    ] as [number, [Cell, Cell]][]) {
                        const otherHaveCandidateCells = this.board.byGlobalRow(row)
                            .filter(cell => cell.globalColumn != column1 && cell.globalColumn != column2 && cell.hasCandidate(attempt));
                        if (otherHaveCandidateCells.length > 0) {
                            ok = true;
                            const segments: ReasonSegment[] = [
                                { kind: 'text', text: 'x: cells ' },
                            ];
                            for (const cell of otherHaveCandidateCells) {
                                segments.push({ kind: 'cell-id', id: cell.id });
                                segments.push({ kind: 'text', text: ';' })
                            }
                            segments.pop();
                            segments.push({ kind: 'text', text: ' cannot have ' });
                            segments.push({ kind: 'number', value: attempt });
                            segments.push({ kind: 'text', text: ' because this value must be in ' });
                            segments.push({ kind: 'cell-id', id: thecells[0].id });
                            segments.push({ kind: 'text', text: ' or ' });
                            segments.push({ kind: 'cell-id', id: thecells[1].id });
                            segments.push({ kind: 'text', text: ` because there are both only 2 occurence of this value in column ${column1
                                } and column ${column2} and they are both in row ${column1Cells[0].globalRow} and row ${column1Cells[1].globalRow}` });
                            this.reason(segments, otherHaveCandidateCells.map(cell => ({ kind: 'draft-off', id: cell.id, value: attempt })));
                        }
                    }
                }
            }
        }

        return ok;
    }

    // cell a and b are same region, b and c are same region, c and d are same region, d and a are same region
    // if select one value in a will make b and c left with only one selection (which requires b and c only have 2 selection)
    // and than b and c's selection make d no possible values, than a should not select that value
    // this is actually one special case of 2-step backtrack
    private simpleSameRegionCircle = () => {
        let ok = false;
        const cells = this.board.cells.filter(cell => !cell.hasValue);

        // this seems to be the easiest way to enumerate size 4 sub slices
        for (let i1 = 0; i1 < cells.length - 3; i1 += 1) {
            for (let i2 = i1 + 1; i2 < cells.length - 2; i2 += 1) {
                for (let i3 = i2 + 1; i3 < cells.length - 1; i3 += 1) {
                    for (let i4 = i3 + 1; i4 < cells.length; i4 += 1) {
                        const the4 = [cells[i1], cells[i2], cells[i3], cells[i4]];
                        if (![
                            // try multiple circle order
                            [0, 1, 2, 3],
                            [0, 1, 3, 2],
                            [0, 2, 1, 3],
                            [0, 2, 3, 1],
                            [0, 3, 1, 2],
                            [0, 3, 2, 1],
                        ].some(seq =>
                            the4[seq[0]].isSameRegion(the4[seq[1]])
                            && the4[seq[1]].isSameRegion(the4[seq[2]])
                            && the4[seq[2]].isSameRegion(the4[seq[3]])
                            && the4[seq[3]].isSameRegion(the4[seq[0]])
                        )) {
                            continue;
                        }
                        if (the4[0].isId([1, 9]) && the4[1].isId([3, 8]) && the4[2].isId([4, 9]) && the4[3].isId([5, 8])) {
                            console.log('interest case');
                        }
                        const the3 = the4.filter(cell => cell.candidates.length == 2);
                        const the1Selection = the3.length == 3
                            // if one of them draft count is not 2, that is the one to be attempted
                            ? the4.filter(cell => cell.candidates.length != 2)
                            // if 4 of them are length 4, then need try each
                            : the3.length == 4 ? the4 : [];
                        if (the1Selection.length == 0) {
                            // console.log(`the1selection is empty for 4cells ${the4.map(cell => cell.globalCoordinate.join(',')).join(';')}`);
                            continue;
                        }
                        for (const the1 of the1Selection) {
                            // also need victim selection if the remaining 3 are all same region of the1
                            const theVictimSelection = the4.filter(cell => cell.isSameRegion(the1)).length == 2
                                ? the4.filter(cell => !cell.isSameRegion(the1))
                                // if all 3 are same region with the1, this does not mean can select any of them as victim
                                // because some cell may not be same region with thesameregion2
                                : the4.filter(cell => !cell.isSame(the1));
                            for (const theVictim of theVictimSelection) {
                                const theSameRegion2 = the4.filter(cell => !cell.isSame(the1) && !cell.isSame(theVictim));
                                // ATTENTION if remaining 3 are all same region with the1,
                                // this does not mean any of the remainging 3 can become victim, it may not be same region with the 2
                                if (!theVictim.isSameRegion(theSameRegion2[0]) || theVictim.isSameRegion(theSameRegion2[1])) {
                                    continue;
                                }
                                // console.log(`the1 ${the1.globalCoordinate.join(',')} the2 ${
                                //     theSameRegion2[0].globalCoordinate.join(',')};${
                                //     theSameRegion2[1].globalCoordinate.join(',')} the victim ${theVictim.globalCoordinate.join(',')}`);
                                const theVictimDraftValues = theVictim.candidates;
                                for (const attempt of the1.candidates) {
                                    if (!theSameRegion2[0].hasCandidate(attempt) || !theSameRegion2[1].hasCandidate(attempt)) {
                                        // console.log(`reject attempt ${attempt}`);
                                        continue;
                                    }
                                    const the2Values = theSameRegion2.map(cell => cell.candidates.filter(x => x != attempt)[0]);
                                    the2Values.sort((a, b) => a - b); 
                                    if (the2Values[0] == theVictimDraftValues[0] && the2Values[1] == theVictimDraftValues[1]) {
                                        ok = true;
                                        this.reason([
                                            { kind: 'text', text: 'simple-circle: cell ' },
                                            { kind: 'cell-id', id: the1.id },
                                            { kind: 'text', text: ' cannot be ' },
                                            { kind: 'number', value: attempt },
                                            { kind: 'text', text: ' because this will make cell ' },
                                            { kind: 'cell-id', id: theSameRegion2[0].id },
                                            { kind: 'text', text: ' become ' },
                                            { kind: 'number', value: theSameRegion2[0].candidates.filter(x => x != attempt)[0] },
                                            { kind: 'text', text: ' and cell ' },
                                            { kind: 'cell-id', id: theSameRegion2[1].id },
                                            { kind: 'text', text: ' become ' },
                                            { kind: 'number', value: theSameRegion2[1].candidates.filter(x => x != attempt)[0] },
                                            { kind: 'text', text: ' which will make cell ' },
                                            { kind: 'cell-id', id: theVictim.id },
                                            { kind: 'text', text: ' have no possiblility' },
                                        ], [
                                            { kind: 'draft-off', id: the1.id, value: attempt },
                                        ])
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return ok;
    }

    // they call this swordfish
    // if a value in draft make form like this
    // 1      1
    // 1    1 1
    //      1 1
    // which I regard them as an arrow toword right top
    // |-----|
    // |---| |
    //     |-|
    // then if no additional cells in these 3 rows have the value
    // then other cells in these 3 columns cannot have the value
    // or if no additional cells in these 3 columns have the value
    // then other cells in these 3 rows cannot have the value  

    private thickv = () => {
        let ok = false;

        return ok;
    }
    
}

const ui = makeui();
const board = new Board(ui);
const modal = new Modal(ui);
const behavior = window['thegame'] = new Behavior(board, modal, ui);
behavior.setInferrer(new Inferrer(behavior, ui));
