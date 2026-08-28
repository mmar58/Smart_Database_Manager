export function showModal(id: string) {
    const overlay = document.getElementById(id);
    if (overlay) overlay.style.display = 'flex';
}

export function hideModal(id: string) {
    const overlay = document.getElementById(id);
    if (overlay) overlay.style.display = 'none';
}

export function initModals() {
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.getAttribute('data-close');
            if (modalId) hideModal(modalId);
        });
    });
}
