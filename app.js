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
            // Si no hay datos, inicializamos con algunas filas de ejemplo vacías
            if (savedAccounts && savedAccounts.length > 0) {
                accounts.value = savedAccounts;
            } else {
                accounts.value = [
                    { name: 'LON-01', nodeId: '', ip: '' },
                    { name: 'LON-02', nodeId: '', ip: '' },
                    { name: 'LON-03', nodeId: '', ip: '' }
                ];
            }
            
            pool.value = JSON.parse(localStorage.getItem('vpn_erp_pool')) || [];
            blacklist.value = JSON.parse(localStorage.getItem('vpn_erp_blacklist')) || [];
        };

        // Guardar automáticamente cada vez que cambie algo en las tablas
        watch([accounts, pool, blacklist], saveData, { deep: true });

        // --- MOTOR DE COLISIONES ---
        // Verifica si la IP o el ID de la cuenta actual choca con CUALQUIER otra cuenta en la tabla
        const hasCollision = (currentAccount) => {
            // Si ambos están vacíos, no hay choque
            if (!currentAccount.ip && !currentAccount.nodeId) return false;
            
            return accounts.value.some(acc => {
                // No comparar la fila consigo misma
                if (acc === currentAccount) return false;
                
                // Limpiar espacios para comparar
                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();

                // Choca si las IPs son iguales (y no están vacías)
                const ipChoque = accIp !== '' && curIp !== '' && accIp === curIp;
                
                // Choca si los Nodos son iguales (y no están vacíos)
                const nodoChoque = accNode !== '' && curNode !== '' && accNode === curNode;
                
                return ipChoque || nodoChoque;
            });
        };

        // Cuenta total de filas en estado rojo (choque)
        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        // --- ERP: CONTROL MANUAL DE CUENTAS ---
        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ 
                name: `LON-${num < 10 ? '0'+num : num}`, 
                nodeId: '', 
                ip: '' 
            });
            // Re-renderizar iconos en caso de que cambie la vista
            setTimeout(() => lucide.createIcons(), 50);
        };

        const removeAccount = (index) => {
            if(confirm("¿Estás seguro de eliminar esta fila por completo?")) {
                accounts.value.splice(index, 1);
            }
        };

        // Acción "Quemar": Toma el nodo de la fila, lo mete en Blacklist, y limpia la fila
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
                    // Truncar a 15 por si acaso
                    const truncado = nodeStr.substring(0, 15);
                    // Asegurar que no esté ya en Blacklist
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: ipStr || 'Desconocida' });
                    }
                }
                
                // Vaciar la fila actual
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
            
            // Separar por saltos de línea, comas o espacios
            const rawItems = bulkBlacklistText.value.split(/[\n,\s]+/);
            let agregados = 0;
            let descartados = 0;

            rawItems.forEach(item => {
                const limpio = item.trim();
                // Validar que sea un string medianamente largo (un hash de nodo)
                if(limpio.length >= 10) { 
                    const truncado = limpio.substring(0, 15);
                    
                    // Solo agregar si NO existe en la blacklist
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: 'Importado desde Excel' });
                        agregados++;
                    } else {
                        descartados++;
                    }
                }
            });

            bulkBlacklistText.value = ''; // Limpiar el input
            alert(`Proceso completado:\n- ${agregados} nodos bloqueados con éxito.\n- ${descartados} duplicados ignorados.`);
        };

        const removeBlacklistNode = (index) => {
            if(confirm("¿Eliminar este nodo de la lista negra? Podrá volver a aparecer en el Pool.")) {
                blacklist.value.splice(index, 1);
            }
        };

        // Buscador para la lista negra
        const filteredBlacklist = computed(() => {
            if(!blacklistSearch.value) return blacklist.value;
            const term = blacklistSearch.value.toLowerCase();
            return blacklist.value.filter(b => 
                b.nodeId.toLowerCase().includes(term) || 
                b.ip.toLowerCase().includes(term)
            );
        });

        // --- POOL: CONEXIÓN A LA API DE MYSTERIUM ---
        const fetchFromAPI = async () => {
            syncStatus.value = 'Conectando a Mysterium...';
            try {
                // Endpoint proporcionado por el usuario
                const url = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential&quality_min=2.5";
                const response = await fetch(url, { headers: { 'accept': 'application/json' }});
                
                if (!response.ok) throw new Error("Error de red");
                
                const data = await response.json();
                const rawPool = [];
                
                data.forEach(nodo => {
                    // Regla de negocio: Solo Wireguard
                    if (nodo.service_type !== "wireguard") return;
                    
                    const idCorto = nodo.provider_id.substring(0, 15);
                    
                    // Regla de negocio: Ocultar los que ya están bloqueados o en uso actual
                    const enBlacklist = blacklist.value.some(b => b.nodeId === idCorto);
                    const enUso = accounts.value.some(a => {
                        const accNode = (a.nodeId || '').trim();
                        return accNode !== '' && accNode === idCorto;
                    });
                    
                    if (!enBlacklist && !enUso) {
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
                
                syncStatus.value = `¡${pool.value.length} nodos filtrados y listos!`;
                
                // Limpiar mensaje después de 3 segundos
                setTimeout(() => { syncStatus.value = ''; }, 3000);

            } catch (error) {
                console.error(error);
                syncStatus.value = 'Error al conectar con la API';
                setTimeout(() => { syncStatus.value = ''; }, 3000);
            }
        };

        // Copiar ID al portapapeles desde el Pool
        const copyToClipboard = async (text) => {
            try {
                await navigator.clipboard.writeText(text);
                syncStatus.value = '¡ID copiado al portapapeles!';
                setTimeout(() => { syncStatus.value = ''; }, 2000);
            } catch (err) {
                console.error('No se pudo copiar: ', err);
            }
        };

        // --- EXPORTAR BASE DE DATOS (Backup) ---
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

        // Al iniciar la aplicación
        onMounted(() => {
            loadData();
            // Actualizar iconos iniciales
            setTimeout(() => { if(window.lucide) lucide.createIcons(); }, 100);
        });

        // Retornar al template de Vue
        return {
            currentTab, accounts, pool, blacklist, syncStatus, 
            bulkBlacklistText, blacklistSearch, filteredBlacklist, collisionCount,
            hasCollision, addAccount, removeAccount, burnNode, 
            processBulkBlacklist, removeBlacklistNode, fetchFromAPI, 
            copyToClipboard, exportDatabase
        };
    }
}).mount('#app');
