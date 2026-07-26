const { createApp, ref, computed, watch, onMounted } = Vue;

createApp({
    setup() {
        // --- ESTADO DE NAVEGACIÓN E INTERFAZ ---
        const currentTab = ref('accounts');
        const syncStatus = ref('');
        const bulkBlacklistText = ref('');
        const blacklistSearch = ref('');
        
        // --- BASE DE DATOS (Reactiva) ---
        const accounts = ref([]);
        const pool = ref([]);
        const blacklist = ref([]);

        // --- PERSISTENCIA (LocalStorage) ---
        const saveData = () => {
            localStorage.setItem('vpn_erp_accounts', JSON.stringify(accounts.value));
            localStorage.setItem('vpn_erp_pool', JSON.stringify(pool.value));
            localStorage.setItem('vpn_erp_blacklist', JSON.stringify(blacklist.value));
        };

        const loadData = () => {
            const savedAccounts = JSON.parse(localStorage.getItem('vpn_erp_accounts'));
            
            // Si ya hay cuentas guardadas, se cargan. 
            // Si no (primera vez), creamos 28 cuentas para ahorrarte el trabajo.
            if (savedAccounts && savedAccounts.length > 0) {
                accounts.value = savedAccounts;
            } else {
                const initialAccounts = [];
                for(let i = 1; i <= 28; i++) {
                    const num = i < 10 ? '0'+i : i;
                    initialAccounts.push({ name: `LON-${num}`, nodeId: '', ip: '' });
                }
                accounts.value = initialAccounts;
            }
            
            pool.value = JSON.parse(localStorage.getItem('vpn_erp_pool')) || [];
            blacklist.value = JSON.parse(localStorage.getItem('vpn_erp_blacklist')) || [];
        };

        // Guardar automáticamente cada vez que cambie algo en las tablas
        watch([accounts, pool, blacklist], saveData, { deep: true });

        // --- MOTOR DE COLISIONES ---
        const hasCollision = (currentAccount) => {
            if (!currentAccount.ip && !currentAccount.nodeId) return false;
            
            return accounts.value.some(acc => {
                if (acc === currentAccount) return false;
                
                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();

                const ipChoque = accIp !== '' && curIp !== '' && accIp === curIp;
                const nodoChoque = accNode !== '' && curNode !== '' && accNode === curNode;
                
                return ipChoque || nodoChoque;
            });
        };

        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        // --- ERP: CONTROL MANUAL DE CUENTAS ---
        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ 
                name: `LON-${num < 10 ? '0'+num : num}`, 
                nodeId: '', 
                ip: '' 
            });
            setTimeout(() => lucide.createIcons(), 50);
        };

        const removeAccount = (index) => {
            if(confirm("¿Estás seguro de eliminar esta fila por completo?")) {
                accounts.value.splice(index, 1);
            }
        };

        const burnNode = (index) => {
            const acc = accounts.value[index];
            const nodeStr = (acc.nodeId || '').trim();
            const ipStr = (acc.ip || '').trim();

            if(!nodeStr && !ipStr) {
                alert("La fila ya está vacía, no hay nada que quemar."); 
                return;
            }
            
            if(confirm(`¿Mover el nodo "${nodeStr || 'Sin ID'}" a la Lista Negra? La fila quedará vacía lista para otro nodo.`)) {
                if(nodeStr) {
                    const truncado = nodeStr.substring(0, 15);
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: ipStr || 'Desconocida' });
                    }
                }
                
                accounts.value[index].nodeId = '';
                accounts.value[index].ip = '';
            }
        };

        // --- ERP: CARGA MASIVA A LISTA NEGRA ---
        const processBulkBlacklist = () => {
            if(!bulkBlacklistText.value.trim()) {
                alert("El cuadro de texto está vacío. Pega tus IDs primero.");
                return;
            }
            
            const rawItems = bulkBlacklistText.value.split(/[\n,\s]+/);
            let agregados = 0;
            let descartados = 0;

            rawItems.forEach(item => {
                const limpio = item.trim();
                if(limpio.length >= 10) { 
                    const truncado = limpio.substring(0, 15);
                    
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: 'Importado masivo' });
                        agregados++;
                    } else {
                        descartados++;
                    }
                }
            });

            bulkBlacklistText.value = ''; 
            alert(`Proceso completado:\n- ${agregados} nodos bloqueados con éxito.\n- ${descartados} duplicados ignorados.`);
        };

        const removeBlacklistNode = (index) => {
            if(confirm("¿Eliminar este nodo de la lista negra? Podrá volver a aparecer en el Pool.")) {
                blacklist.value.splice(index, 1);
            }
        };

        const filteredBlacklist = computed(() => {
            if(!blacklistSearch.value) return blacklist.value;
            const term = blacklistSearch.value.toLowerCase();
            return blacklist.value.filter(b => 
                b.nodeId.toLowerCase().includes(term) || 
                b.ip.toLowerCase().includes(term)
            );
        });

        // --- POOL: IMPORTACIÓN MANUAL DE JSON (API de Mysterium) ---
        const importPoolJSON = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            
            syncStatus.value = 'Procesando archivo...';
            
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    
                    if (!Array.isArray(data)) {
                        throw new Error("El archivo no tiene el formato esperado (debe ser un array).");
                    }

                    const rawPool = [];
                    let nodosValidos = 0;
                    
                    data.forEach(nodo => {
                        // Filtro 1: Debe ser Wireguard
                        if (nodo.service_type !== "wireguard") return;
                        
                        // Validar que provider_id exista para evitar errores
                        if (!nodo.provider_id) return;
                        
                        const idCorto = nodo.provider_id.substring(0, 15);
                        
                        // Filtro 2: Ocultar los que ya están en Lista Negra o en Uso
                        const enBlacklist = blacklist.value.some(b => b.nodeId === idCorto);
                        const enUso = accounts.value.some(a => {
                            const accNode = (a.nodeId || '').trim();
                            return accNode !== '' && accNode === idCorto;
                        });
                        
                        if (!enBlacklist && !enUso) {
                            nodosValidos++;
                            rawPool.push({
                                id: idCorto,
                                country: nodo.location?.country || 'N/A',
                                city: nodo.location?.city || 'N/A',
                                asn_isp: `${nodo.location?.asn || ''} - ${nodo.location?.isp || 'N/A'}`,
                                q_score: (nodo.quality?.quality || 0).toFixed(2)
                            });
                        }
                    });

                    // Ordenar por calidad (mayor a menor)
                    pool.value = rawPool.sort((a, b) => b.q_score - a.q_score);
                    
                    syncStatus.value = `¡Se cargaron ${pool.value.length} nodos listos!`;
                    
                    // Resetear el input file para poder subir el mismo archivo después
                    event.target.value = null; 
                    
                    setTimeout(() => { syncStatus.value = ''; }, 4000);

                } catch (err) {
                    console.error(err);
                    alert("Error al leer el JSON: " + err.message);
                    syncStatus.value = 'Error de lectura';
                    event.target.value = null;
                    setTimeout(() => { syncStatus.value = ''; }, 3000);
                }
            };
            reader.readAsText(file);
        };

        const copyToClipboard = async (text) => {
            try {
                await navigator.clipboard.writeText(text);
                syncStatus.value = '¡ID copiado al portapapeles!';
                setTimeout(() => { syncStatus.value = ''; }, 2000);
            } catch (err) {
                console.error('No se pudo copiar: ', err);
            }
        };

        // --- EXPORTAR BASE DE DATOS (Backup general) ---
        const exportDatabase = () => {
            const backupData = { 
                exportDate: new Date().toISOString(),
                accounts: accounts.value, 
                pool: pool.value, 
                blacklist: blacklist.value 
            };
            
            const dataStr = JSON.stringify(backupData, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `VPN_ERP_Backup_${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };

        onMounted(() => {
            loadData();
            setTimeout(() => { if(window.lucide) lucide.createIcons(); }, 100);
        });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, 
            bulkBlacklistText, blacklistSearch, filteredBlacklist, collisionCount,
            hasCollision, addAccount, removeAccount, burnNode, 
            processBulkBlacklist, removeBlacklistNode, importPoolJSON, 
            copyToClipboard, exportDatabase
        };
    }
}).mount('#app');
