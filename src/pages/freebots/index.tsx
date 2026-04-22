import { observer } from 'mobx-react-lite';

const FreeBots = observer(() => {
    return (
        <div className='freebots-page' style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100%',
            background: 'var(--general-main-1)'
        }}>
            <div className='coming-soon-card' style={{
                textAlign: 'center',
                padding: '4rem',
                background: 'var(--general-section-1)',
                borderRadius: '2.4rem',
                boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                maxWidth: '400px'
            }}>
                <h1 style={{ fontSize: '3.2rem', marginBottom: '1.6rem', color: 'var(--text-prominent)' }}>FreeBots</h1>
                <p style={{ fontSize: '1.6rem', color: 'var(--text-less-prominent)', lineHeight: '1.5' }}>
                    Access our collection of open-source automated strategies. We are curating the best bots for the 2026 market.
                </p>
                <div style={{ 
                    marginTop: '2.4rem', 
                    padding: '0.8rem 1.6rem', 
                    background: 'var(--brand-red-coral)', 
                    color: 'white',
                    borderRadius: '2rem',
                    display: 'inline-block',
                    fontWeight: 'bold'
                }}>
                    Coming Soon
                </div>
            </div>
        </div>
    );
});

export default FreeBots;
