export const SOCIAL_PANEL_CSS = `
.dsh-pet-social{height:100%;min-height:0;display:flex;flex-direction:column;gap:10px;padding:12px;color:var(--dsw-color-text);background:var(--dsw-color-bg-container);font-size:13px}
.dsh-pet-social *{box-sizing:border-box}
.dsh-pet-social-head{display:flex;align-items:center;gap:8px}
.dsh-pet-social-head strong{flex:1;font-size:15px}
.dsh-pet-social-select{width:100%;padding:7px 8px;border:1px solid var(--dsw-color-border);border-radius:6px;color:inherit;background:var(--dsw-color-bg-elevated)}
.dsh-pet-social-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--dsw-color-text-secondary);font-size:12px}
.dsh-pet-social-members{padding:6px 8px;border-radius:6px;background:var(--dsw-color-fill-secondary);line-height:1.5}
.dsh-pet-social-messages{flex:1;min-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:4px 2px}
.dsh-pet-social-message{display:flex;flex-direction:column;gap:3px;max-width:92%;align-self:flex-start}
.dsh-pet-social-message.owner{align-self:flex-end;text-align:right}
.dsh-pet-social-message-name{font-size:11px;color:var(--dsw-color-text-secondary)}
.dsh-pet-social-bubble{padding:8px 10px;border-radius:10px;background:var(--dsw-color-fill-secondary);white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.55}
.dsh-pet-social-message.owner .dsh-pet-social-bubble{background:var(--dsw-color-primary-bg);color:var(--dsw-color-primary-text)}
.dsh-pet-social-message.failed .dsh-pet-social-bubble{border:1px solid var(--dsw-color-error)}
.dsh-pet-social-status{font-size:11px;color:var(--dsw-color-text-tertiary)}
.dsh-pet-social-empty{margin:auto;text-align:center;color:var(--dsw-color-text-secondary);line-height:1.8}
.dsh-pet-social-composer{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--dsw-color-border);padding-top:10px}
.dsh-pet-social-input{width:100%;min-height:68px;resize:vertical;padding:8px;border:1px solid var(--dsw-color-border);border-radius:6px;color:inherit;background:var(--dsw-color-bg-elevated);font:inherit}
.dsh-pet-social-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.dsh-pet-social-button{padding:6px 10px;border:1px solid var(--dsw-color-border);border-radius:6px;color:inherit;background:var(--dsw-color-bg-elevated);cursor:pointer}
.dsh-pet-social-button.primary{border-color:var(--dsw-color-primary);background:var(--dsw-color-primary);color:var(--dsw-color-white)}
.dsh-pet-social-button:disabled{opacity:.5;cursor:not-allowed}
.dsh-pet-social-error{padding:7px 8px;border-radius:6px;color:var(--dsw-color-error);background:var(--dsw-color-error-bg);font-size:12px}
`;
