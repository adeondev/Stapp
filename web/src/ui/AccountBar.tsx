import './accountbar.css'

interface Props {
  username: string
  onLogout(): void
}

export function AccountBar({ username, onLogout }: Props) {
  return (
    <div className="accountbar">
      <div className="accountbar__identity">
        <span className="accountbar__avatar" aria-hidden="true">
          {username.slice(0, 1).toUpperCase()}
        </span>
        <span className="accountbar__username" title={username}>{username}</span>
      </div>
      <button className="accountbar__logout" type="button" onClick={onLogout}>
        sair
      </button>
    </div>
  )
}
