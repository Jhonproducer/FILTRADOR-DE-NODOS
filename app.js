const { createApp, ref, computed, watch, onMounted } = Vue;

createApp({
    setup() {
        const currentTab = ref('accounts');
        const syncStatus = ref('');
        
        // --- BASE DE DATOS (Estado Reactivo) ---
        const accounts = ref([]);
        const pool = ref([]);
        const blacklist = ref([]);

        // --- PERSISTENCIA (LocalStorage) ---
        const saveData = () => {
            localStorage.setItem('vpn_accounts', JSON.stringify(accounts.value));
            localStorage.setItem('vpn_pool', JSON.stringify(pool.value));
            localStorage.setItem('vpn_blacklist', JSON.stringify(blacklist.value));
        };

        const loadData = () => {
            accounts.value = JSON.parse(localStorage.getItem('vpn_accounts')) || [{ name: 'LON-01', nodeId: '', ip: '' }];
            pool.value = JSON.parse(localStorage.getItem('vpn_pool')) || [];
            blacklist.value = JSON.parse(localStorage.getItem('vpn_blacklist')) || [];
        };

        // Guardar automáticamente si algo cambia
        watch([accounts, pool, blacklist], saveData, { deep: true });

        // --- SISTEMA DE COLISIONES ---
        // Verifica si la IP o el ID de una cuenta existe en OTRA cuenta distinta
        const hasCollision = (currentAccount) => {
            if (!currentAccount.ip && !currentAccount.nodeId) return false;
            
            return accounts.value.some(acc => {
                if (acc === currentAccount) return false; // No compararse consigo mismo
                const ipChoque = acc.ip && acc.ip === currentAccount.ip;
                const nodoChoque = acc.nodeId && acc.nodeId === currentAccount.nodeId;
                return ipChoque || nodoChoque;
            });
        };

        const collisionCount = computed(() => {
            return accounts.value.filter(acc => hasCollision(acc)).length;
        });

        // --- ACCIONES DE CUENTAS ---
        const addNewAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ name: `LON-${num < 10 ? '0'+num : num}`, nodeId: '', ip: '' });
        };

        const moveToBlacklist = (index) => {
            const acc = accounts.value[index];
            if(acc.nodeId) blacklist.value.push({ nodeId: acc.nodeId, ip: acc.ip });
            // Limpiar la cuenta
            accounts.value[index].nodeId = '';
            accounts.value[index].ip = '';
        };

        const replaceFromPool = (index) => {
            if (pool.value.length === 0) {
                alert("El Pool está vacío. Sincroniza la API primero.");
                return;
            }
            // Tomar el mejor nodo (el primero, ya que están ordenados por calidad)
            const bestNode = pool.value.shift(); 
            accounts.value[index].nodeId = bestNode.id;
            accounts.value[index].ip = "Pendiente..."; // La IP real la pones tú o tu script al conectar
        };

        const restoreFromBlacklist = (index) => {
            blacklist.value.splice(index, 1);
        };

        // --- LLAMADO A LA API MYSTERIUM ---
        const fetchFromAPI = async () => {
            syncStatus.value = 'Conectando...';
            try {
                const url = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential&quality_min=2.5";
                const response = await fetch(url, { headers: { 'accept': 'application/json' }});
                const data = await response.json();
                
                const rawPool = [];
                data.forEach(nodo => {
                    if (nodo.service_type !== "wireguard") return;
                    
                    const loc = nodo.location || {};
                    const idCorto = nodo.provider_id.substring(0, 15);
                    
                    // Validar que no esté en lista negra ni activo actualmente
                    const estaEnBlacklist = blacklist.value.some(b => b.nodeId === idCorto);
                    const estaActivo = accounts.value.some(a => a.nodeId === idCorto);
                    
                    if (!estaEnBlacklist && !estaActivo) {
                        rawPool.push({
                            id: idCorto,
                            country: loc.country || 'N/A',
                            city: loc.city || 'N/A',
                            asn_isp: `${loc.asn || ''} - ${loc.isp || 'N/A'}`,
                            q_score: (nodo.quality?.quality || 0).toFixed(2)
                        });
                    }
                });

                // Ordenar por calidad
                pool.value = rawPool.sort((a, b) => b.q_score - a.q_score);
                syncStatus.value = `¡${pool.value.length} nodos listos!`;
                
                setTimeout(() => { syncStatus.value = ''; }, 3000);

            } catch (error) {
                console.error(error);
                syncStatus.value = 'Error en API';
                setTimeout(() => { syncStatus.value = ''; }, 3000);
            }
        };

        // --- IMPORTAR / EXPORTAR ---
        const exportData = () => {
            const dataStr = JSON.stringify({
                accounts: accounts.value,
                pool: pool.value,
                blacklist: blacklist.value
            }, null, 2);
            
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `vpn_manager_backup_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
        };

        const importJSON = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const parsed = JSON.parse(e.target.result);
                    if(parsed.accounts) accounts.value = parsed.accounts;
                    if(parsed.pool) pool.value = parsed.pool;
                    if(parsed.blacklist) blacklist.value = parsed.blacklist;
                    alert("Base de datos importada correctamente.");
                } catch (err) {
                    alert("Error leyendo el archivo JSON.");
                }
            };
            reader.readAsText(file);
        };

        // Iniciar
        onMounted(() => {
            loadData();
        });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, collisionCount,
            hasCollision, addNewAccount, moveToBlacklist, replaceFromPool, restoreFromBlacklist,
            fetchFromAPI, exportData, importJSON
        };
    }
}).mount('#app');
