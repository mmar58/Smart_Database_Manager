import { state } from '../state';
import { socket } from '../services/socket';
import { escapeHtml } from '../utils';

let erTables: Record<string, any[]> = {};
let erFkData: any[] = [];

export function renderERDiagram(database: string, fkData: any[]) {
    erFkData = fkData || [];
    const canvas = document.getElementById('erCanvas');
    const svg = document.getElementById('erSvg');
    if (!canvas || !svg) return;

    // Remove old cards
    canvas.querySelectorAll('.er-table-card').forEach(c => c.remove());
    svg.innerHTML = '';
    erTables = {};

    // Load table structures for all tables in the database
    const tables = Array.from(document.querySelectorAll(`#dbtables-${database} .table-node`))
        .map(n => (n as HTMLElement).dataset.table)
        .filter(Boolean) as string[];

    if (!tables.length) {
        if ((window as any).showNotification) (window as any).showNotification('No tables in the selected database', 'warning');
        return;
    }

    let loaded = 0;
    tables.forEach((table) => {
        socket.emit('get_table_structure', { database, table });
        socket.once(`table_structure_${database}_${table}`, (structure: any[]) => {
            erTables[table] = structure;
            loaded++;
            if (loaded === tables.length) drawERCards(tables);
        });
    });
}

function drawERCards(tables: string[]) {
    const canvas = document.getElementById('erCanvas');
    if (!canvas) return;

    let html = '';
    let x = 20;
    let y = 20;
    let rowMaxHeight = 0;
    const canvasRect = canvas.getBoundingClientRect();

    tables.forEach(table => {
        const structure = erTables[table] || [];
        html += `
            <div class="er-table-card" id="ercard-${table}" style="left:${x}px; top:${y}px;" data-table="${table}">
                <div class="er-table-header">${escapeHtml(table)}</div>
                <div class="er-columns">
                    ${structure.map(c => `
                        <div class="er-col" id="ercol-${table}-${c.Field}">
                            <span class="${c.Key === 'PRI' ? 'er-pk' : c.Key === 'MUL' ? 'er-fk' : ''}">${escapeHtml(c.Field)}</span>
                            <span class="text-xs text-muted">${escapeHtml(c.Type)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        // Simple layout logic
        x += 260;
        const estHeight = 40 + (structure.length * 28);
        rowMaxHeight = Math.max(rowMaxHeight, estHeight);
        
        if (x + 250 > Math.max(800, canvasRect.width)) {
            x = 20;
            y += rowMaxHeight + 40;
            rowMaxHeight = 0;
        }
    });

    canvas.insertAdjacentHTML('beforeend', html);

    // Make Draggable
    document.querySelectorAll('.er-table-card').forEach(card => {
        makeDraggable(card as HTMLElement);
    });

    // Draw SVG Lines
    drawERLines();
}

function makeDraggable(el: HTMLElement) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = el.querySelector('.er-table-header') as HTMLElement;
    if (header) {
        header.onmousedown = dragMouseDown;
    }

    function dragMouseDown(e: MouseEvent) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e: MouseEvent) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        el.style.top = (el.offsetTop - pos2) + "px";
        el.style.left = (el.offsetLeft - pos1) + "px";
        drawERLines();
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

function drawERLines() {
    const svg = document.getElementById('erSvg');
    const canvas = document.getElementById('erCanvas');
    if (!svg || !canvas) return;
    
    svg.innerHTML = '';
    const canvasRect = canvas.getBoundingClientRect();

    erFkData.forEach(fk => {
        const fromCol = document.getElementById(`ercol-${fk.TABLE_NAME}-${fk.COLUMN_NAME}`);
        const toCol = document.getElementById(`ercol-${fk.REFERENCED_TABLE_NAME}-${fk.REFERENCED_COLUMN_NAME}`);

        if (fromCol && toCol) {
            const fromRect = fromCol.getBoundingClientRect();
            const toRect = toCol.getBoundingClientRect();

            const x1 = fromRect.left - canvasRect.left + (fromRect.width / 2);
            const y1 = fromRect.top - canvasRect.top + (fromRect.height / 2);
            const x2 = toRect.left - canvasRect.left + (toRect.width / 2);
            const y2 = toRect.top - canvasRect.top + (toRect.height / 2);

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const d = `M ${x1} ${y1} C ${(x1+x2)/2} ${y1}, ${(x1+x2)/2} ${y2}, ${x2} ${y2}`;
            path.setAttribute('d', d);
            path.setAttribute('class', 'er-line');
            path.setAttribute('stroke', 'var(--primary)');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('fill', 'none');
            svg.appendChild(path);
        }
    });
}
