// tsc index.ts --target es6 --lib dom,es2020

interface Operation {
    // start from 1
    gridIndex: number,
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

class Cell {
    private readonly game: Game;
    public readonly gridIndex: number;
    public readonly cellIndex: number;
    // start from 1
    public readonly row: number;
    // start from 1
    public readonly column: number;
    private readonly element: HTMLDivElement;
    // index start from 1, 0 is dummy
    private readonly draftElements: HTMLDivElement[];
    private readonly finalValueElement: HTMLDivElement;

    private readonly _draftValues: number[];
    public get draftValues(): ReadonlyArray<number> { return this._draftValues; }
    private _finalValue: number | null;
    public get finalValue() { return this._finalValue; }

    // cell index start from 1
    public constructor(game: Game, gridElement: HTMLDivElement, gridIndex: number, cellIndex: number) {
        this.game = game;
        this.gridIndex = gridIndex;
        this.cellIndex = cellIndex;
        // div.cell.cell-1.row-1.col-1
        //   div.draft.draft-1
        //   ...
        //   div.final
        this.element = document.createElement('div');
        this.row = Math.floor((cellIndex - 1) / 3) + 1;
        this.column = (cellIndex - 1) % 3 + 1;
        this.element.className=`cell cell-${cellIndex} row-${this.row} col-${this.column}`;
        this.element.setAttribute('tabindex', '0');
        this.element.addEventListener('keydown', this.handleKeydown);
        this.element.addEventListener('focus', this.handleFocus);
        this.element.addEventListener('blur', this.handleBlur);
        gridElement.appendChild(this.element);
        this._draftValues = [];
        this.draftElements = [null as unknown as HTMLDivElement];
        for (let draftIndex = 1; draftIndex <= 9; draftIndex += 1) {
            const draft = document.createElement('div');
            draft.className=`draft draft-${draftIndex}`;
            draft.innerText = draftIndex.toString();
            draft.style.visibility = 'hidden';
            this.element.appendChild(draft);
            this.draftElements.push(draft);
        }
        this.finalValueElement = document.createElement('div');
        this.finalValueElement.className = 'final';
        this.element.appendChild(this.finalValueElement);
    }

    private handleKeydown = (e: KeyboardEvent) => {
        if (e.key == 'ArrowLeft') {

        } else if (e.key == 'ArrowRight') {

        } else if (e.key == 'ArrowUp') {

        } else if (e.key == 'ArrowDown') {

        } else if (e.key == 'Backspace' || e.key == 'Delete') {
            if (this._finalValue) {
                this.game.push({ gridIndex: this.gridIndex, cellIndex: this.cellIndex, kind: 'clear-value' });
            }
        } else if (['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(e.key)) {
            const value = parseInt(e.key);
            if (e.altKey && !this._finalValue) {
                if (this._draftValues.includes(value)) {
                    this.game.push({ gridIndex: this.gridIndex, cellIndex: this.cellIndex, kind: 'draft-off', value });
                } else {
                    this.game.push({ gridIndex: this.gridIndex, cellIndex: this.cellIndex, kind: 'draft-on', value });
                }
            } else if (!e.altKey && this._finalValue != value) {
                this.game.push({ gridIndex: this.gridIndex, cellIndex: this.cellIndex, kind: 'set-value', value });
            }
        } else if (e.key == 'z' && e.ctrlKey) {
            this.game.pop();
        } else if (e.key == 'Enter') {
            this.game.check();
        }
    }
    private handleFocus = (e: FocusEvent) => {
        // row
        this.game.forEachGrid(grid => {
            if (grid.row == this.game.grid(this.gridIndex).row) {
                grid.forEachCell(cell => {
                    if (cell.row == this.row) {
                        cell.highlight(true);
                    }
                });
            } else if (grid.column == this.game.grid(this.gridIndex).column) {
                grid.forEachCell(cell => {
                    if (cell.column == this.column) {
                        cell.highlight(true);
                    }
                })
            }
        });
        this.game.grid(this.gridIndex).forEachCell(cell => cell.highlight(true));
    }
    private handleBlur = (e: FocusEvent) => {
        this.game.forEachGrid(grid => grid.forEachCell(cell => cell.highlight(false)));
    }

    public draftOn(value: number) {
        this._draftValues.push(value);
        this.draftElements[value].style.visibility = 'visible';
    }
    public draftOff(value: number) {
        this._draftValues.splice(this._draftValues.indexOf(value), 1);
        this.draftElements[value].style.visibility = 'hidden';
    }
    public setValue(value: number) {
        this._finalValue = value;
        this.finalValueElement.innerText = value.toString();
    }
    public clearValue() {
        this._finalValue = null;
        this.finalValueElement.innerText = '';
    }
    // not that highlight, add a background
    public highlight(v: boolean) {
        this.element.style.backgroundColor = v ? '#E0E0E0' : 'white';
    }

    public apply(op: Operation) {
        if (op.kind == 'draft-on') {
            if (this._finalValue) {
                throw 'invalid operation, draft on when have final value';
            } else if (this._draftValues.includes(op.value!)) {
                throw 'invalid operation, draft on duplicate';
            }
            this.draftOn(op.value!);
        } else if (op.kind == 'draft-off') {
            if (this._finalValue) {
                throw 'invalid operation, draft off when have final value';
            } else if (!this._draftValues.includes(op.value!)) {
                throw 'invalid operation, draft off when not exist';
            }
            this.draftOff(op.value!);
        } else if (op.kind == 'set-value') {
            op.oldValue = this._finalValue!;
            op.oldDrafts = [...this._draftValues];
            for (let draftIndex = 1; draftIndex <= 9; draftIndex += 1) {
                // this function does not validate so can directly clear all
                this.draftOff(draftIndex);
            }
            this.setValue(op.value!);
        } else if (op.kind == 'clear-value') {
            if (!this._finalValue) {
                throw 'invalid operation, clear final value when not have final value';
            }
            op.oldValue = this._finalValue!;
            this.clearValue();
        }
    }
    public reverseApply(op: Operation) {
        if (op.kind == 'draft-on') {
            if (this._finalValue) {
                throw 'invalid reverse operation, cannot reverse draft on when have final value'
            } else if (!this._draftValues.includes(op.value!)) {
                throw 'invalid reverse opration, cannot reverse draft on when that is not on';
            }
            this.draftOff(op.value!);
        } else if (op.kind == 'draft-off') {
            if (this._finalValue) {
                throw 'invalid reverse operation, cannot reverse draft off when have final value'
            } else if (this._draftValues.includes(op.value!)) {
                throw 'invalid reverse opration, cannot reverse draft off when that is not off';
            }
            this.draftOn(op.value!);
        } else if (op.kind == 'set-value') {
            if (op.oldValue) {
                this.setValue(op.oldValue);
            } else {
                for (const draftIndex of op.oldDrafts!) {
                    this.draftOn(draftIndex);
                }
                this.clearValue();
            }
        } else if (op.kind == 'clear-value') {
            if (this._finalValue) {
                throw 'invalid operation, cannot reverse clear final value when have final value';
            }
            this.setValue(op.oldValue!);
        }
    }

    public forEachSiblingInRow(callback: (cell: Cell) => any) {
        this.game.forEachGrid(grid => {
            if (grid.row == this.game.grid(this.gridIndex).row) {
                grid.forEachCell(cell => {
                    if (cell.row == this.row) {
                        callback(cell);
                    }
                });
            }
        });
    }
    public forEachSiblingInColumn(callback: (cell: Cell) => any) {
        this.game.forEachGrid(grid => {
            if (grid.column == this.game.grid(this.gridIndex).column) {
                grid.forEachCell(cell => {
                    if (cell.column == this.column) {
                        callback(cell);
                    }
                })
            }
        });
    }
    public forEachSiblingInGrid(callback: (cell: Cell) => any) {
        this.game.grid(this.gridIndex).forEachCell(cell => callback(cell));
    }
}

class Grid {
    private readonly game: Game;
    public readonly gridIndex: number;
    // start from 1
    public readonly row: number;
    // start from 1
    public readonly column: number;
    private readonly element: HTMLDivElement;
    // index start from 1, 0 is dummy
    private readonly cells: Cell[];
    // grid index start from 1
    public constructor(game: Game, containerElement: HTMLDivElement, gridIndex: number) {
        this.game = game;
        this.gridIndex = gridIndex;
        // div.grid.grid-1.row-1.col-1
        this.element = document.createElement('div');
        this.row = Math.floor((gridIndex - 1) / 3) + 1;
        this.column = (gridIndex - 1) % 3 + 1;
        this.element.className = `grid grid-${gridIndex} row-${this.row} col-${this.column}`;
        containerElement.appendChild(this.element);
        this.cells = [null as unknown as Cell];
        for (let cellIndex = 1; cellIndex <= 9; cellIndex += 1) {
            this.cells.push(new Cell(game, this.element, gridIndex, cellIndex));
        }
    }
    // index start from 1, row and column start from 1
    public cell(indexOrRow: number, maybeColumn?: number) {
        return typeof maybeColumn == 'number' ? this.cells[(indexOrRow - 1) * 3 + maybeColumn!] : this.cells[indexOrRow];
    }
    public forEachCell(callback: (cell: Cell, index: number) => any) {
        this.cells.slice(1).forEach((cell, index) => callback(cell, index + 1));
    }
    // highlight all cells
    public highlight(v: boolean) {
        this.forEachCell(cell => cell.highlight(v));
    }
}

class Game {
    private readonly element: HTMLDivElement;
    // index start from 1, 0 is dummy
    private readonly grids: Grid[];
    // operations, for now only one history line
    private readonly operations: Operation[];

    constructor(element: HTMLDivElement) {
        this.element = element;
        this.grids = [null as unknown as Grid];
        for (let gridIndex = 1; gridIndex <= 9; gridIndex += 1) {
            this.grids.push(new Grid(this, this.element, gridIndex));
        }
        this.operations = [];
    }
    // index start from 1, row and column start from 1
    public grid(indexOrRow: number, maybeColumn?: number) {
        return typeof maybeColumn == 'number' ? this.grids[(indexOrRow - 1) * 3 + maybeColumn] : this.grids[indexOrRow];
    }
    public forEachGrid(callback: (grid: Grid, index: number) => any) {
        this.grids.slice(1).forEach((grid, index) => callback(grid, index + 1));
    }
    
    public push(op: Operation) {
        this.operations.push(op);
        this.grid(op.gridIndex).cell(op.cellIndex).apply(op);
    }
    public pop() {
        if (this.operations.length) {
            const op = this.operations.pop()!;
            this.grid(op.gridIndex).cell(op.cellIndex).reverseApply(op);
        }
    }

    public check() {
        let filled = true;
        this.forEachGrid(grid => grid.forEachCell(cell => {
            if (!cell.finalValue) {
                filled = false;
            }
        }));
        if (!filled) {
            alert('not filled');
        }

    }
}

const rootElement = document.querySelector('div#board-container') as HTMLDivElement;
const game = window['thegame'] = new Game(rootElement);

// random fill for test display
// for (let gridIndex = 1; gridIndex <= 9; gridIndex += 1) {
//     for (let cellIndex = 1; cellIndex <= 9; cellIndex += 1) {
//         const randomDraft = Math.floor(Math.random() * 9 + 1);
//         game.push({ gridIndex, cellIndex, kind: 'draft-on', value: randomDraft });
//         const randomValue = Math.floor(Math.random() * 9 + 1);
//         game.push({ gridIndex, cellIndex, kind: 'set-value', value: randomValue });
//         const randomHighlight = Math.random() > 0.5;
//         game.grid(gridIndex).cell(cellIndex).highlight(randomHighlight);
//     }
// }

window['autopencil'] = function autopencil() {
    game.forEachGrid(grid => grid.forEachCell(cell => {
        if (!cell.finalValue) {
            const values: Set<number> = new Set();
            cell.forEachSiblingInRow(cell => { if (cell.finalValue) { values.add(cell.finalValue); } });
            cell.forEachSiblingInColumn(cell => { if (cell.finalValue) { values.add(cell.finalValue); } });
            cell.forEachSiblingInGrid(cell => { if (cell.finalValue) { values.add(cell.finalValue); } });
            const allValues = [1, 2, 3, 4, 5, 6, 7, 8, 9];
            for (const value of allValues.filter(v => !values.has(v) && !cell.draftValues.includes(v))) {
                cell.draftOn(value);
            }
        }
    }))
}
