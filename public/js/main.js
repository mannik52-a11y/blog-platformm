// Плавное исчезновение уведомлений
setTimeout(() => {
    document.querySelectorAll('.alert').forEach(alert => {
        alert.style.opacity = '0';
        setTimeout(() => alert.remove(), 300);
    });
}, 4000);

// Подтверждение удаления
document.querySelectorAll('.delete-btn, form[action*="delete"]').forEach(form => {
    form.addEventListener('submit', (e) => {
        if (!confirm('Вы уверены?')) e.preventDefault();
    });
});
